import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { isIgnoredTable, isIncludedXinfoHidden } from "./schema-filter.js";
import type { MigrationFile, ReplayMigrationsResult, SchemaReader } from "./types.js";
import type { SchemaSnapshot } from "./types.js";

type SqliteModule = typeof import("node:sqlite");

function loadNodeSqlite(): SqliteModule {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const type = typeof args[0] === "string" ? args[0] : undefined;
    const message = typeof warning === "string" ? warning : warning.message;
    if (
      type === "ExperimentalWarning" &&
      message.includes("SQLite is an experimental feature")
    ) {
      return;
    }
    return originalEmitWarning(warning, ...(args as []));
  }) as typeof process.emitWarning;
  try {
    const require = createRequire(import.meta.url);
    return require("node:sqlite") as SqliteModule;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function readSchemaFromDb(
  db: DatabaseSync,
  ignoreTables: readonly string[],
): SchemaSnapshot {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as { name: string }[];

  const snapshot = new Map<string, string[]>();

  for (const { name } of tables) {
    if (isIgnoredTable(name, ignoreTables)) {
      continue;
    }
    const rows = db.prepare(`PRAGMA table_xinfo(${quoteIdent(name)})`).all() as {
      name: string;
      hidden: number;
    }[];
    const columns: string[] = [];
    for (const row of rows) {
      if (isIncludedXinfoHidden(row.hidden)) {
        columns.push(row.name);
      }
    }
    columns.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    snapshot.set(name, columns);
  }

  return snapshot;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function replayWithDatabaseSync(
  DatabaseSyncCtor: SqliteModule["DatabaseSync"],
  migrations: MigrationFile[],
  ignoreTables: readonly string[],
): ReplayMigrationsResult {
  const db = new DatabaseSyncCtor(":memory:");
  try {
    for (const migration of migrations) {
      try {
        db.exec(migration.sql);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          migrationFile: migration.fileName,
          sqlError: detail,
        };
      }
    }
    return { ok: true, schema: readSchemaFromDb(db, ignoreTables) };
  } finally {
    db.close();
  }
}

let cachedReader: SchemaReader | undefined;

/** Default schema reader using Node's built-in `node:sqlite`. */
export function createNodeSqliteSchemaReader(): SchemaReader {
  if (!cachedReader) {
    const { DatabaseSync } = loadNodeSqlite();
    cachedReader = {
      replayMigrations(migrations, ignoreTables) {
        return replayWithDatabaseSync(DatabaseSync, migrations, ignoreTables);
      },
    };
  }
  return cachedReader;
}
