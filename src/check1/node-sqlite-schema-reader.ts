import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { isIgnoredTable, isIncludedXinfoHidden } from "./schema-filter.js";
import type { MigrationFile, ReplayMigrationsResult, SchemaReader } from "./types.js";
import type { SchemaSnapshot } from "./types.js";

type SqliteModule = typeof import("node:sqlite");

function warningTypeFromEmitArgs(args: unknown[]): string | undefined {
  if (typeof args[0] === "string") {
    return args[0];
  }
  if (args[0] && typeof args[0] === "object" && "type" in args[0]) {
    const type = (args[0] as { type?: unknown }).type;
    return typeof type === "string" ? type : undefined;
  }
  return undefined;
}

function shouldSuppressSqliteExperimentalWarning(
  warning: string | Error,
  args: unknown[],
): boolean {
  const type = warningTypeFromEmitArgs(args);
  const message = typeof warning === "string" ? warning : warning.message;
  return (
    type === "ExperimentalWarning" &&
    message.includes("SQLite is an experimental feature")
  );
}

/** Loads `node:sqlite`, suppressing only its experimental warning during the load. */
export function loadNodeSqlite(
  loader: () => SqliteModule = () => {
    const require = createRequire(import.meta.url);
    return require("node:sqlite") as SqliteModule;
  },
): SqliteModule {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (shouldSuppressSqliteExperimentalWarning(warning, args)) {
      return;
    }
    return originalEmitWarning(warning, ...(args as []));
  }) as typeof process.emitWarning;
  try {
    return loader();
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
