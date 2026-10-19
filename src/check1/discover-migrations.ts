import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MigrationFile } from "./types.js";

function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Lists `*.sql` files in `migrationsDir`, sorted by file name (code-unit order).
 * Missing directories and empty results both yield an empty list.
 */
export function discoverMigrationFiles(migrationsDir: string): MigrationFile[] {
  let names: string[];
  try {
    names = readdirSync(migrationsDir);
  } catch {
    return [];
  }

  const sqlNames = names.filter((name) => name.endsWith(".sql"));
  sqlNames.sort(compareCodeUnits);

  return sqlNames.map((fileName) => {
    const filePath = join(migrationsDir, fileName);
    const sql = readFileSync(filePath, "utf8");
    return { fileName, filePath, sql };
  });
}
