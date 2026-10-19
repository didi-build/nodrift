import { fatal } from "../findings.js";
import { loadDataMapFile } from "../load.js";
import { compareSchemaToMap, countSchema } from "./compare.js";
import { discoverMigrationFiles } from "./discover-migrations.js";
import { createNodeSqliteSchemaReader } from "./node-sqlite-schema-reader.js";
import type { CheckMapVsMigrationsResult, SchemaReader } from "./types.js";

export type CheckMapVsMigrationsOptions = {
  mapFilePath: string;
  migrationsDir: string;
  ignoreTables?: readonly string[];
  schemaReader?: SchemaReader;
};

export function checkMapVsMigrations(
  options: CheckMapVsMigrationsOptions,
): CheckMapVsMigrationsResult {
  const {
    mapFilePath,
    migrationsDir,
    ignoreTables = [],
    schemaReader = createNodeSqliteSchemaReader(),
  } = options;

  const loaded = loadDataMapFile(mapFilePath);
  if ("fatal" in loaded) {
    return { kind: "fatal", fatal: loaded.fatal };
  }

  const { map, findings: loaderFindings } = loaded;
  if (loaderFindings.length > 0) {
    return { kind: "findings", findings: loaderFindings };
  }

  const migrations = discoverMigrationFiles(migrationsDir);
  const declaresD1Tables = Object.keys(map.d1_tables).length > 0;

  if (migrations.length === 0) {
    if (declaresD1Tables) {
      return {
        kind: "fatal",
        fatal: fatal(
          mapFilePath,
          `no migrations found at \`${migrationsDir}\` but the map declares D1 tables; check the \`migrations\` path`,
        ),
      };
    }
    return {
      kind: "ok",
      outcome: "nothing_to_check",
      tableCount: 0,
      columnCount: 0,
    };
  }

  const replayed = schemaReader.replayMigrations(migrations, ignoreTables);
  if (!replayed.ok) {
    const failed = migrations.find((m) => m.fileName === replayed.migrationFile);
    return {
      kind: "fatal",
      fatal: fatal(
        failed?.filePath ?? mapFilePath,
        `migration \`${replayed.migrationFile}\` failed: ${replayed.sqlError}`,
      ),
    };
  }

  const comparisonFindings = compareSchemaToMap(replayed.schema, map, mapFilePath);
  if (comparisonFindings.length > 0) {
    return { kind: "findings", findings: comparisonFindings };
  }

  const { tableCount, columnCount } = countSchema(replayed.schema);
  return {
    kind: "ok",
    outcome: "checked",
    tableCount,
    columnCount,
  };
}
