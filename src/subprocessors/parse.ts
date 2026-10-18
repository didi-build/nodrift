import type { Finding } from "../findings.js";
import { finding, fatal } from "../findings.js";
import { parseYamlDocument } from "../yaml-parse.js";
import { isBoolean, isNonEmptyString, isString, typoHint } from "../data-map/fields.js";
import type { ParseSubprocessorsResult, Subprocessor } from "./types.js";

const TOP_LEVEL_KEYS = new Set(["schema_version", "subprocessors"]);
const ENTRY_KEYS = new Set([
  "name",
  "purpose",
  "data",
  "location",
  "verified",
  "notes",
]);
const SUPPORTED_SCHEMA_VERSION = 1;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function pushUnknownKeys(
  findings: Finding[],
  file: string,
  yamlPath: string,
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      const hint = typoHint(key, allowed);
      const hintText = hint ? ` (did you mean \`${hint}\`?)` : "";
      findings.push(
        finding(
          file,
          yamlPath ? `${yamlPath}.${key}` : key,
          "unknown_key",
          `unknown key \`${key}\`${hintText}`,
          `remove \`${key}\` or rename it to a supported field`,
        ),
      );
    }
  }
}

export function parseSubprocessors(
  text: string,
  filePath: string,
): ParseSubprocessorsResult {
  const parsed = parseYamlDocument(text, filePath);
  if (!parsed.ok) {
    return { fatal: parsed.error };
  }

  const findings: Finding[] = [];
  const record = asRecord(parsed.value);
  if (!record) {
    findings.push(
      finding(
        filePath,
        "",
        "invalid_root",
        "subprocessors file root must be a mapping",
        "start with `schema_version` and `subprocessors`",
      ),
    );
    return {
      subprocessors: { schema_version: 0, subprocessors: [] },
      findings,
    };
  }

  pushUnknownKeys(findings, filePath, "", record, TOP_LEVEL_KEYS);

  let schemaVersion = 0;
  if (!("schema_version" in record)) {
    findings.push(
      finding(
        filePath,
        "schema_version",
        "missing_schema_version",
        "missing required `schema_version`",
        "add `schema_version: 1`",
      ),
    );
  } else {
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
      if (rawVersion > SUPPORTED_SCHEMA_VERSION) {
        return {
          fatal: fatal(
            filePath,
            `schema_version ${rawVersion} requires a newer nodrift; upgrade nodrift`,
          ),
        };
      }
      if (rawVersion !== SUPPORTED_SCHEMA_VERSION) {
        findings.push(
          finding(
            filePath,
            "schema_version",
            "unsupported_schema_version",
            `unsupported schema_version ${rawVersion}`,
            `set schema_version to ${SUPPORTED_SCHEMA_VERSION}`,
          ),
        );
      }
    }
  }

  const subprocessors: Subprocessor[] = [];
  if (!("subprocessors" in record)) {
    findings.push(
      finding(
        filePath,
        "subprocessors",
        "missing_subprocessors",
        "missing required `subprocessors` list",
        "add a `subprocessors` list",
      ),
    );
  } else if (!Array.isArray(record.subprocessors)) {
    findings.push(
      finding(
        filePath,
        "subprocessors",
        "invalid_type",
        "`subprocessors` must be a list",
        "add `subprocessors` as a YAML list",
      ),
    );
  } else {
    const seen = new Map<string, number>();
    record.subprocessors.forEach((raw, index) => {
      const yamlPath = `subprocessors[${index}]`;
      const entry = asRecord(raw);
      if (!entry) {
        findings.push(
          finding(
            filePath,
            yamlPath,
            "invalid_type",
            "subprocessor entry must be a mapping",
            "add `name`, `purpose`, and `data`",
          ),
        );
        return;
      }
      pushUnknownKeys(findings, filePath, yamlPath, entry, ENTRY_KEYS);

      const name = entry.name;
      if (!isNonEmptyString(name)) {
        findings.push(
          finding(
            filePath,
            `${yamlPath}.name`,
            "missing_required_field",
            "missing required field `name`",
            "add a unique vendor `name`",
          ),
        );
        return;
      }

      const prev = seen.get(name);
      if (prev !== undefined) {
        findings.push(
          finding(
            filePath,
            `${yamlPath}.name`,
            "duplicate_subprocessor_name",
            `duplicate subprocessor name \`${name}\``,
            `use a unique name (also declared at subprocessors[${prev}])`,
          ),
        );
      } else {
        seen.set(name, index);
      }

      if (!isNonEmptyString(entry.purpose)) {
        findings.push(
          finding(
            filePath,
            `${yamlPath}.purpose`,
            "missing_required_field",
            "missing required field `purpose`",
            "describe what the subprocessor does",
          ),
        );
      }
      if (!isNonEmptyString(entry.data)) {
        findings.push(
          finding(
            filePath,
            `${yamlPath}.data`,
            "missing_required_field",
            "missing required field `data`",
            "describe what data is shared with this subprocessor",
          ),
        );
      }
      if (
        "location" in entry &&
        entry.location !== undefined &&
        !isString(entry.location)
      ) {
        findings.push(
          finding(
            filePath,
            `${yamlPath}.location`,
            "invalid_type",
            "`location` must be a string",
            "set `location` to where data is processed",
          ),
        );
      }
      if (
        "verified" in entry &&
        entry.verified !== undefined &&
        !isBoolean(entry.verified)
      ) {
        findings.push(
          finding(
            filePath,
            `${yamlPath}.verified`,
            "invalid_type",
            "`verified` must be a boolean",
            "set `verified` to `true` or `false`",
          ),
        );
      }
      if ("notes" in entry && entry.notes !== undefined && !isString(entry.notes)) {
        findings.push(
          finding(
            filePath,
            `${yamlPath}.notes`,
            "invalid_type",
            "`notes` must be a string",
            "set `notes` to free-form text or remove the field",
          ),
        );
      }

      subprocessors.push({
        name,
        purpose: isString(entry.purpose) ? entry.purpose : "",
        data: isString(entry.data) ? entry.data : "",
        location: isString(entry.location) ? entry.location : undefined,
        verified: typeof entry.verified === "boolean" ? entry.verified : undefined,
        notes: isString(entry.notes) ? entry.notes : undefined,
      });
    });
  }

  return {
    subprocessors: { schema_version: schemaVersion, subprocessors },
    findings,
  };
}
