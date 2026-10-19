export const SUPPORTED_DATA_MAP_SCHEMA_VERSION = 1;

export const DATA_MAP_TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "d1_tables",
  "other_items",
]);

export const TABLE_KEYS = new Set(["defaults", "columns"]);

export const COLUMN_FIELD_KEYS = new Set([
  "whose",
  "data",
  "purpose",
  "storage",
  "processors",
  "retention",
  "who_can_see",
  "source",
  "verified",
  "notes",
]);

export const OTHER_ITEM_KEYS = new Set([
  "id",
  "whose",
  "data",
  "purpose",
  "processors",
  "retention",
  "binding",
  "storage",
  "who_can_see",
  "source",
  "verified",
  "notes",
]);

export const RESERVED_WHOSE = new Set(["operational", "TODO"]);

export function levenshtein1(a: string, b: string): boolean {
  if (a === b) {
    return false;
  }
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > 1) {
    return false;
  }
  if (al === bl) {
    let mismatches = 0;
    for (let i = 0; i < al; i++) {
      if (a[i] !== b[i]) {
        mismatches++;
      }
    }
    return mismatches === 1;
  }
  if (al + 1 === bl) {
    return oneInsertionAway(a, b);
  }
  return oneInsertionAway(b, a);
}

function oneInsertionAway(shorter: string, longer: string): boolean {
  let i = 0;
  let j = 0;
  let usedSkip = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    if (usedSkip) {
      return false;
    }
    usedSkip = true;
    j++;
  }
  return true;
}

export function typoHint(
  unknownKey: string,
  allowed: ReadonlySet<string>,
): string | undefined {
  const matches = [...allowed].filter((key) => levenshtein1(unknownKey, key));
  if (matches.length === 1) {
    return matches[0];
  }
  return undefined;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
