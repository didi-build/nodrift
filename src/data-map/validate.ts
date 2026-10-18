import type { Finding } from "../findings.js";
import { finding, fatal } from "../findings.js";
import {
  COLUMN_FIELD_KEYS,
  DATA_MAP_TOP_LEVEL_KEYS,
  isNonEmptyString,
  isString,
  OTHER_ITEM_KEYS,
  SUPPORTED_DATA_MAP_SCHEMA_VERSION,
  TABLE_KEYS,
} from "./fields.js";
import type {
  ColumnOverride,
  DataMap,
  D1Table,
  OtherItem,
  TableDefaults,
} from "./types.js";
import {
  mergeColumnLayer,
  pushUnknownKeys,
  validateBinding,
  validateColumnFields,
} from "./validate-helpers.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function parseColumnOverride(
  raw: unknown,
  findings: Finding[],
  file: string,
  yamlPath: string,
): ColumnOverride {
  const record = asRecord(raw);
  if (!record) {
    findings.push(
      finding(
        file,
        yamlPath,
        "invalid_type",
        "column entry must be a mapping",
        "use `column_name: {}` or `column_name: { whose: ... }`",
      ),
    );
    return {};
  }
  pushUnknownKeys(findings, file, yamlPath, record, COLUMN_FIELD_KEYS);
  validateColumnFields(findings, file, yamlPath, record);
  const out: ColumnOverride = {};
  for (const key of COLUMN_FIELD_KEYS) {
    if (key in record) {
      const value = record[key];
      if (key === "processors" && isStringList(value)) {
        out.processors = value;
      } else if (key === "verified" && typeof value === "boolean") {
        out.verified = value;
      } else if (typeof value === "string") {
        (out as Record<string, string>)[key] = value;
      }
    }
  }
  return out;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseTableDefaults(
  raw: unknown,
  findings: Finding[],
  file: string,
  yamlPath: string,
): TableDefaults | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const record = asRecord(raw);
  if (!record) {
    findings.push(
      finding(
        file,
        yamlPath,
        "invalid_type",
        "`defaults` must be a mapping",
        "set `defaults` to shared column fields",
      ),
    );
    return undefined;
  }
  validateColumnFields(findings, file, yamlPath, record);
  return parseColumnOverride(raw, findings, file, yamlPath);
}

function tableHasPersonalColumn(columns: Record<string, ColumnOverride>): boolean {
  for (const override of Object.values(columns)) {
    if (override.whose !== undefined && override.whose !== "operational") {
      return true;
    }
  }
  return false;
}

function validatePersonalRequirements(
  findings: Finding[],
  file: string,
  yamlPath: string,
  merged: Record<string, unknown>,
): void {
  const whose = merged.whose;
  if (whose === "TODO") {
    findings.push(
      finding(
        file,
        `${yamlPath}.whose`,
        "whose_todo",
        "classify this",
        "replace `whose: TODO` with a real classification (not `operational` unless there is no personal data)",
      ),
    );
    return;
  }
  if (whose === "operational") {
    return;
  }

  for (const field of ["data", "purpose", "retention"] as const) {
    const value = merged[field];
    if (value === undefined) {
      findings.push(
        finding(
          file,
          `${yamlPath}.${field}`,
          "missing_required_field",
          `missing required field \`${field}\``,
          `add \`${field}\` for this personal-data entry`,
        ),
      );
    } else if (!isNonEmptyString(value)) {
      findings.push(
        finding(
          file,
          `${yamlPath}.${field}`,
          "empty_required_string",
          `\`${field}\` must be a non-empty string`,
          `set \`${field}\` to a non-empty description`,
        ),
      );
    }
  }

  if (!("processors" in merged)) {
    findings.push(
      finding(
        file,
        `${yamlPath}.processors`,
        "missing_required_field",
        "missing required field `processors`",
        "add `processors` as a list (use `[]` when there are no subprocessors)",
      ),
    );
  }
}

function validateD1Table(
  findings: Finding[],
  file: string,
  tableName: string,
  raw: unknown,
): D1Table | undefined {
  const yamlPath = `d1_tables.${tableName}`;
  const record = asRecord(raw);
  if (!record) {
    findings.push(
      finding(
        file,
        yamlPath,
        "invalid_type",
        "table entry must be a mapping with `columns`",
        "add a `columns` mapping listing every column",
      ),
    );
    return undefined;
  }

  pushUnknownKeys(findings, file, yamlPath, record, TABLE_KEYS);

  const defaults = parseTableDefaults(
    record.defaults,
    findings,
    file,
    `${yamlPath}.defaults`,
  );

  if (!("columns" in record)) {
    findings.push(
      finding(
        file,
        `${yamlPath}.columns`,
        "missing_columns",
        "missing required `columns` mapping",
        "add `columns` with every column name in this table",
      ),
    );
    return undefined;
  }

  const columnsRaw = record.columns;
  const columnsRecord = asRecord(columnsRaw);
  if (!columnsRecord || Object.keys(columnsRecord).length === 0) {
    findings.push(
      finding(
        file,
        `${yamlPath}.columns`,
        "empty_columns",
        "`columns` must list at least one column",
        "add each column name under `columns`",
      ),
    );
    return undefined;
  }

  const columns: Record<string, ColumnOverride> = {};
  for (const columnName of Object.keys(columnsRecord)) {
    columns[columnName] = parseColumnOverride(
      columnsRecord[columnName],
      findings,
      file,
      `${yamlPath}.columns.${columnName}`,
    );
  }

  const mixed = tableHasPersonalColumn(columns);
  if (mixed && defaults?.whose !== undefined) {
    findings.push(
      finding(
        file,
        `${yamlPath}.defaults.whose`,
        "defaults_whose_on_personal_table",
        "`defaults` must not set `whose` when this table has personal-data columns",
        "remove `whose` from `defaults` and set `whose` on each column",
      ),
    );
  }

  const defaultsRecord = defaults as Record<string, unknown> | undefined;
  for (const columnName of Object.keys(columns)) {
    const columnPath = `${yamlPath}.columns.${columnName}`;
    const override = columns[columnName];
    const overrideRecord = override as Record<string, unknown>;
    const merged = mergeColumnLayer(defaultsRecord, overrideRecord);

    let effectiveWhose: string | undefined;
    if (override.whose !== undefined) {
      effectiveWhose = override.whose;
    } else if (!mixed && defaults?.whose !== undefined) {
      effectiveWhose = defaults.whose;
    }

    if (effectiveWhose === undefined) {
      findings.push(
        finding(
          file,
          columnPath,
          "column_needs_whose",
          "needs `whose`",
          "set `whose` on this column (or use table `defaults` only on purely operational tables)",
        ),
      );
      continue;
    }

    merged.whose = effectiveWhose;
    validatePersonalRequirements(findings, file, columnPath, merged);
  }

  return { defaults, columns };
}

function parseOtherItem(
  raw: unknown,
  findings: Finding[],
  file: string,
  index: number,
): OtherItem | undefined {
  const yamlPath = `other_items[${index}]`;
  const record = asRecord(raw);
  if (!record) {
    findings.push(
      finding(
        file,
        yamlPath,
        "invalid_type",
        "other item must be a mapping",
        "use a YAML mapping with `id`, `whose`, `data`, `purpose`, `processors`, and `retention`",
      ),
    );
    return undefined;
  }

  pushUnknownKeys(findings, file, yamlPath, record, OTHER_ITEM_KEYS);
  validateColumnFields(findings, file, yamlPath, record);
  validateBinding(findings, file, yamlPath, record.binding);

  const id = record.id;
  if (!isNonEmptyString(id)) {
    findings.push(
      finding(
        file,
        `${yamlPath}.id`,
        "missing_required_field",
        "missing required field `id`",
        "add a unique `id` for this item",
      ),
    );
    return undefined;
  }

  const itemPath = `other_items.${id}`;
  const merged: Record<string, unknown> = { ...record };
  validatePersonalRequirements(findings, file, itemPath, merged);

  const processors = record.processors;
  const item: OtherItem = {
    id,
    whose: isString(record.whose) ? record.whose : "",
    data: isString(record.data) ? record.data : "",
    purpose: isString(record.purpose) ? record.purpose : "",
    processors: isStringList(processors) ? processors : [],
    retention: isString(record.retention) ? record.retention : "",
  };

  if (record.binding !== undefined) {
    if (isNonEmptyString(record.binding)) {
      item.binding = record.binding;
    } else if (
      isStringList(record.binding) &&
      record.binding.length > 0 &&
      record.binding.every(isNonEmptyString)
    ) {
      item.binding = record.binding;
    }
  }
  if (isString(record.storage)) {
    item.storage = record.storage;
  }
  if (isString(record.who_can_see)) {
    item.who_can_see = record.who_can_see;
  }
  if (isString(record.source)) {
    item.source = record.source;
  }
  if (typeof record.verified === "boolean") {
    item.verified = record.verified;
  }
  if (isString(record.notes)) {
    item.notes = record.notes;
  }

  return item;
}

export type ValidateDataMapRootResult =
  | { ok: true; map: DataMap; findings: Finding[] }
  | { ok: false; fatal: import("../findings.js").FatalError; findings: Finding[] };

export function validateDataMapRoot(
  root: unknown,
  filePath: string,
): ValidateDataMapRootResult {
  const findings: Finding[] = [];

  const record = asRecord(root);
  if (!record) {
    findings.push(
      finding(
        filePath,
        "",
        "invalid_root",
        "data map root must be a mapping",
        "start the file with `schema_version` and `d1_tables`",
      ),
    );
    return { ok: true, map: emptyMap(), findings };
  }

  pushUnknownKeys(findings, filePath, "", record, DATA_MAP_TOP_LEVEL_KEYS);

  if (!("schema_version" in record)) {
    findings.push(
      finding(
        filePath,
        "schema_version",
        "missing_schema_version",
        "missing required `schema_version`",
        "add `schema_version: 1` at the top of the file",
      ),
    );
  }

  let schemaVersion = 0;
  if ("schema_version" in record) {
    const rawVersion = record.schema_version;
    if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion)) {
      findings.push(
        finding(
          filePath,
          "schema_version",
          "invalid_schema_version",
          "`schema_version` must be an integer",
          "set `schema_version` to `1`",
        ),
      );
    } else {
      schemaVersion = rawVersion;
      if (rawVersion > SUPPORTED_DATA_MAP_SCHEMA_VERSION) {
        return {
          ok: false,
          fatal: fatal(
            filePath,
            `schema_version ${rawVersion} requires a newer nodrift; upgrade nodrift`,
          ),
          findings,
        };
      }
      if (rawVersion !== SUPPORTED_DATA_MAP_SCHEMA_VERSION) {
        findings.push(
          finding(
            filePath,
            "schema_version",
            "unsupported_schema_version",
            `unsupported schema_version ${rawVersion}`,
            `set schema_version to ${SUPPORTED_DATA_MAP_SCHEMA_VERSION}`,
          ),
        );
      }
    }
  }

  const d1Tables: Record<string, D1Table> = {};
  if ("d1_tables" in record) {
    const tablesRaw = record.d1_tables;
    const tablesRecord = asRecord(tablesRaw);
    if (!tablesRecord) {
      findings.push(
        finding(
          filePath,
          "d1_tables",
          "invalid_type",
          "`d1_tables` must be a mapping of table names",
          "add `d1_tables` with one key per D1 table",
        ),
      );
    } else {
      for (const tableName of Object.keys(tablesRecord)) {
        const table = validateD1Table(
          findings,
          filePath,
          tableName,
          tablesRecord[tableName],
        );
        if (table) {
          d1Tables[tableName] = table;
        }
      }
    }
  } else {
    findings.push(
      finding(
        filePath,
        "d1_tables",
        "missing_d1_tables",
        "missing required `d1_tables`",
        "add a `d1_tables` section",
      ),
    );
  }

  const otherItems: OtherItem[] = [];
  if ("other_items" in record) {
    const itemsRaw = record.other_items;
    if (!Array.isArray(itemsRaw)) {
      findings.push(
        finding(
          filePath,
          "other_items",
          "invalid_type",
          "`other_items` must be a list",
          "add `other_items` as a YAML list",
        ),
      );
    } else {
      const seenIds = new Map<string, number>();
      itemsRaw.forEach((itemRaw, index) => {
        const item = parseOtherItem(itemRaw, findings, filePath, index);
        if (!item) {
          return;
        }
        const prev = seenIds.get(item.id);
        if (prev !== undefined) {
          findings.push(
            finding(
              filePath,
              `other_items[${index}].id`,
              "duplicate_other_item_id",
              `duplicate other_items id \`${item.id}\``,
              `use a unique id (also declared at other_items[${prev}])`,
            ),
          );
        } else {
          seenIds.set(item.id, index);
          otherItems.push(item);
        }
      });
    }
  } else {
    findings.push(
      finding(
        filePath,
        "other_items",
        "missing_other_items",
        "missing required `other_items`",
        "add an `other_items` list (use `[]` if empty)",
      ),
    );
  }

  const map: DataMap = {
    schema_version: schemaVersion,
    d1_tables: d1Tables,
    other_items: otherItems,
  };

  return { ok: true, map, findings };
}

function emptyMap(): DataMap {
  return { schema_version: 0, d1_tables: {}, other_items: [] };
}
