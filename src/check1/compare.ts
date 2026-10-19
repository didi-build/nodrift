import type { DataMap, D1Table } from "../data-map/types.js";
import { finding, type Finding } from "../findings.js";
import type { SchemaSnapshot } from "./types.js";

function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function caseOnlyCounterpart(
  name: string,
  candidates: Iterable<string>,
): string | undefined {
  const lower = name.toLowerCase();
  for (const candidate of candidates) {
    if (candidate !== name && candidate.toLowerCase() === lower) {
      return candidate;
    }
  }
  return undefined;
}

function caseHint(_expected: string, counterpart: string | undefined): string {
  if (!counterpart) {
    return "";
  }
  return ` (schema has \`${counterpart}\`; names differ only in case)`;
}

function isOperationalTable(table: D1Table): boolean {
  return table.defaults?.whose === "operational";
}

function columnAddSnippet(column: string, table: D1Table): string {
  if (isOperationalTable(table)) {
    return `${column}: {}`;
  }
  return `${column}: { whose: TODO }`;
}

function tableAddSnippet(tableName: string, columns: readonly string[]): string {
  const sorted = [...columns].sort(compareCodeUnits);
  const columnLines = sorted
    .map((col) => `      ${col}:\n        whose: TODO`)
    .join("\n");
  return `  ${tableName}:\n    columns:\n${columnLines}`;
}

function countSchema(snapshot: SchemaSnapshot): {
  tableCount: number;
  columnCount: number;
} {
  let columnCount = 0;
  for (const columns of snapshot.values()) {
    columnCount += columns.length;
  }
  return { tableCount: snapshot.size, columnCount };
}

export { countSchema };

/**
 * Pure comparison of an effective schema snapshot to declared `d1_tables` entries.
 */
export function compareSchemaToMap(
  schema: SchemaSnapshot,
  map: DataMap,
  mapFile: string,
): Finding[] {
  const findings: Finding[] = [];
  const mapTables = map.d1_tables;

  const schemaTableNames = [...schema.keys()].sort(compareCodeUnits);
  for (const tableName of schemaTableNames) {
    const schemaColumns = schema.get(tableName) ?? [];
    const mapTable = mapTables[tableName];

    if (!mapTable) {
      const mapTableNames = Object.keys(mapTables);
      const hint = caseHint(tableName, caseOnlyCounterpart(tableName, mapTableNames));
      findings.push(
        finding(
          mapFile,
          `d1_tables.${tableName}`,
          "table_not_in_map",
          `table \`${tableName}\` exists in the schema (${schemaColumns.length} column(s)) but is not declared in the map${hint}`,
          `add to d1_tables:\n${tableAddSnippet(tableName, schemaColumns)}`,
        ),
      );
      continue;
    }

    const mapColumnNames = Object.keys(mapTable.columns);
    const mapColumnSet = new Set(mapColumnNames);
    const sortedSchemaColumns = [...schemaColumns].sort(compareCodeUnits);

    for (const column of sortedSchemaColumns) {
      if (mapColumnSet.has(column)) {
        continue;
      }
      const hint = caseHint(column, caseOnlyCounterpart(column, mapColumnNames));
      findings.push(
        finding(
          mapFile,
          `d1_tables.${tableName}.columns.${column}`,
          "column_not_in_map",
          `column \`${column}\` on table \`${tableName}\` exists in the schema but is not declared in the map${hint}`,
          `add under d1_tables.${tableName}.columns:\n      ${columnAddSnippet(column, mapTable)}`,
        ),
      );
    }
  }

  const mapTableNames = Object.keys(mapTables).sort(compareCodeUnits);
  for (const tableName of mapTableNames) {
    const mapTable = mapTables[tableName];
    const mapColumns = Object.keys(mapTable.columns).sort(compareCodeUnits);

    if (!schema.has(tableName)) {
      const hint = caseHint(
        tableName,
        caseOnlyCounterpart(tableName, schemaTableNames),
      );
      findings.push(
        finding(
          mapFile,
          `d1_tables.${tableName}`,
          "table_not_in_schema",
          `table \`${tableName}\` is declared in the map (${mapColumns.length} column(s)) but does not exist in the schema${hint}`,
          `remove d1_tables.${tableName} or add a migration that creates it`,
        ),
      );
      continue;
    }

    const schemaColumnSet = new Set(schema.get(tableName) ?? []);
    for (const column of mapColumns) {
      if (schemaColumnSet.has(column)) {
        continue;
      }
      const schemaCols = schema.get(tableName) ?? [];
      const hint = caseHint(column, caseOnlyCounterpart(column, schemaCols));
      findings.push(
        finding(
          mapFile,
          `d1_tables.${tableName}.columns.${column}`,
          "column_not_in_schema",
          `column \`${column}\` on table \`${tableName}\` is declared in the map but does not exist in the schema${hint}`,
          `remove d1_tables.${tableName}.columns.${column} or add a migration for it`,
        ),
      );
    }
  }

  findings.sort((a, b) => {
    const tableA = a.path.split(".")[1] ?? "";
    const tableB = b.path.split(".")[1] ?? "";
    const byTable = compareCodeUnits(tableA, tableB);
    if (byTable !== 0) {
      return byTable;
    }
    const colA = a.path.includes(".columns.")
      ? (a.path.split(".columns.")[1] ?? "")
      : "";
    const colB = b.path.includes(".columns.")
      ? (b.path.split(".columns.")[1] ?? "")
      : "";
    return compareCodeUnits(colA, colB);
  });

  return findings;
}
