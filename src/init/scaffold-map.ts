import { stringify } from "yaml";
import { discoverMigrationFiles } from "../check1/discover-migrations.js";
import { createNodeSqliteSchemaReader } from "../check1/node-sqlite-schema-reader.js";
import type { FatalError } from "../findings.js";
import { fatal } from "../findings.js";

export type ScaffoldMapResult =
  | { ok: true; yaml: string; fromMigrations: boolean }
  | { ok: false; fatal: FatalError };

export function scaffoldDataMapYaml(
  migrationsDir: string,
  mapFilePath: string,
): ScaffoldMapResult {
  const discovered = discoverMigrationFiles(migrationsDir);
  if (!discovered.ok) {
    return { ok: false, fatal: discovered.fatal };
  }

  if (discovered.migrations.length === 0) {
    return { ok: true, yaml: "schema_version: 1\n", fromMigrations: false };
  }

  const reader = createNodeSqliteSchemaReader();
  const replayed = reader.replayMigrations(discovered.migrations, []);
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
      columnEntries[column] = {
        whose: "TODO",
        data: "TODO",
        purpose: "TODO",
        processors: [],
        retention: "TODO",
      };
    }
    d1_tables[table] = {
      defaults: {
        storage: "D1",
        processors: ["Cloudflare"],
        who_can_see: "operator",
      },
      columns: columnEntries,
    };
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
