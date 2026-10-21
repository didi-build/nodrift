import { stringify } from "yaml";
import { discoverMigrationFiles } from "../check1/discover-migrations.js";
import { createNodeSqliteSchemaReader } from "../check1/node-sqlite-schema-reader.js";
import type { FatalError } from "../findings.js";
import { fatal } from "../findings.js";

const EMPTY_MAP_YAML = "schema_version: 1\nd1_tables: {}\nother_items: []\n";

export type ScaffoldMapResult =
  | { ok: true; yaml: string; fromMigrations: boolean }
  | { ok: false; fatal: FatalError };

export function scaffoldDataMapYaml(
  migrationsDir: string,
  mapFilePath: string,
  ignoreTables: readonly string[],
): ScaffoldMapResult {
  const discovered = discoverMigrationFiles(migrationsDir);
  if (!discovered.ok) {
    return { ok: false, fatal: discovered.fatal };
  }

  if (discovered.migrations.length === 0) {
    return { ok: true, yaml: EMPTY_MAP_YAML, fromMigrations: false };
  }

  const reader = createNodeSqliteSchemaReader();
  const replayed = reader.replayMigrations(discovered.migrations, ignoreTables);
  if (!replayed.ok) {
    const failed = discovered.migrations.find(
      (m) => m.fileName === replayed.migrationFile,
    );
    return {
      ok: false,
      fatal: fatal(
        failed?.filePath ?? mapFilePath,
        `migration \`${replayed.migrationFile}\` failed: ${replayed.sqlError}`,
      ),
    };
  }

  const d1_tables: Record<string, unknown> = {};
  for (const [table, columns] of replayed.schema) {
    const columnEntries: Record<string, unknown> = {};
    for (const column of columns) {
      columnEntries[column] = { whose: "TODO" };
    }
    d1_tables[table] = { columns: columnEntries };
  }

  const doc = {
    schema_version: 1,
    d1_tables,
    other_items: [],
  };

  return {
    ok: true,
    yaml: stringify(doc).replace(/\r\n/g, "\n"),
    fromMigrations: true,
  };
}
