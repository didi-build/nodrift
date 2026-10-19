import { fatal } from "../findings.js";
import { loadDataMapFile } from "../load.js";
import { compareSchemaToMap, countSchema } from "./compare.js";
import { discoverMigrationFiles, type MigrationFs } from "./discover-migrations.js";
import { createNodeSqliteSchemaReader } from "./node-sqlite-schema-reader.js";
import type { CheckMapVsMigrationsResult, SchemaReader } from "./types.js";

export type CheckMapVsMigrationsOptions = {
  mapFilePath: string;
  migrationsDir: string;
  ignoreTables?: readonly string[];
  schemaReader?: SchemaReader;
  /** @internal Test hook for migration directory reads. */
  migrationFs?: MigrationFs;
};

export function checkMapVsMigrations(
  options: CheckMapVsMigrationsOptions,
): CheckMapVsMigrationsResult {
  const {
    mapFilePath,
    migrationsDir,
    ignoreTables = [],
    schemaReader = createNodeSqliteSchemaReader(),
    migrationFs,
  } = options;

  const loaded = loadDataMapFile(mapFilePath);
  if ("fatal" in loaded) {
    return { kind: "fatal", fatal: loaded.fatal };
  }

  const { map, findings: loaderFindings } = loaded;
  if (loaderFindings.length > 0) {
    return { kind: "findings", findings: loaderFindings };
  }

  const discovered = discoverMigrationFiles(migrationsDir, migrationFs);
  if (!discovered.ok) {
    return { kind: "fatal", fatal: discovered.fatal };
  }
  const migrations = discovered.migrations;
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
    let message = `migration \`${replayed.migrationFile}\` failed: ${replayed.sqlError}`;
    if (replayed.sqlError.startsWith("no such module:")) {
      message +=
        "; this Node's built-in SQLite does not include that module; FTS5 requires Node 22.16 or newer (nodrift supports >=22.13)";
    }
    return {
      kind: "fatal",
      fatal: fatal(failed?.filePath ?? mapFilePath, message),
    };
  }

  const comparisonFindings = compareSchemaToMap(
    replayed.schema,
    map,
    mapFilePath,
    ignoreTables,
  );
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
