import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fatal, type FatalError } from "../findings.js";
import type { MigrationFile } from "./types.js";

export type MigrationFs = {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: "utf8"): string;
};

const defaultMigrationFs: MigrationFs = {
  readdirSync(path) {
    return readdirSync(path);
  },
  readFileSync(path, encoding) {
    return readFileSync(path, encoding);
  },
};

function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function isMissingDirError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
  return false;
}

function formatErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export type DiscoverMigrationsResult =
  { ok: true; migrations: MigrationFile[] } | { ok: false; fatal: FatalError };

/**
 * Lists `*.sql` files in `migrationsDir`, sorted by file name (code-unit order).
 * Missing directories yield an empty list; unreadable paths return a fatal.
 */
export function discoverMigrationFiles(
  migrationsDir: string,
  fs: MigrationFs = defaultMigrationFs,
): DiscoverMigrationsResult {
  let names: string[];
  try {
    names = fs.readdirSync(migrationsDir);
  } catch (err) {
    if (isMissingDirError(err)) {
      return { ok: true, migrations: [] };
    }
    return {
      ok: false,
      fatal: fatal(
        migrationsDir,
        `cannot read migrations directory \`${migrationsDir}\`: ${formatErr(err)}`,
      ),
    };
  }

  const sqlNames = names.filter((name) => name.endsWith(".sql"));
  sqlNames.sort(compareCodeUnits);

  const migrations: MigrationFile[] = [];
  for (const fileName of sqlNames) {
    const filePath = join(migrationsDir, fileName);
    try {
      const sql = fs.readFileSync(filePath, "utf8");
      migrations.push({ fileName, filePath, sql });
    } catch (err) {
      return {
        ok: false,
        fatal: fatal(
          filePath,
          `cannot read migration \`${fileName}\`: ${formatErr(err)}`,
        ),
      };
    }
  }

  return { ok: true, migrations };
}
