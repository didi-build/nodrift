const BUILTIN_IGNORE_PREFIXES = ["sqlite_", "_cf_"] as const;
const BUILTIN_IGNORE_TABLES = new Set(["d1_migrations"]);

export function normalizeTableName(name: string): string {
  return name.toLowerCase();
}

export function isIgnoredTable(
  tableName: string,
  ignoreTables: readonly string[],
): boolean {
  const normalized = normalizeTableName(tableName);
  if (BUILTIN_IGNORE_TABLES.has(normalized)) {
    return true;
  }
  for (const prefix of BUILTIN_IGNORE_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return true;
    }
  }
  for (const ignored of ignoreTables) {
    if (normalizeTableName(ignored) === normalized) {
      return true;
    }
  }
  return false;
}

/** `hidden` values to keep from `PRAGMA table_xinfo` (normal and generated columns). */
export function isIncludedXinfoHidden(hidden: number): boolean {
  return hidden === 0 || hidden === 2 || hidden === 3;
}
