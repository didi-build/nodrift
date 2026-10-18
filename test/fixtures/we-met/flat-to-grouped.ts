/**
 * Test-only converter: we-met flat per-entry map → grouped d1_tables + other_items.
 */
import { parse, stringify } from "yaml";

const MIXED_TABLES = new Set(["accounts", "card_drafts", "cards", "lead_sinks"]);

const FIELD_KEYS = [
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
] as const;

type FlatEntry = Record<string, unknown> & {
  id: string;
  table?: string;
  column?: string;
};

function stableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function pickFields(entry: FlatEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) {
    if (key in entry) {
      out[key] = entry[key];
    }
  }
  return out;
}

function computeDefaults(
  tableName: string,
  rows: FlatEntry[],
): Record<string, unknown> {
  const fieldMaps = rows.map((row) => pickFields(row));
  const defaults: Record<string, unknown> = {};

  for (const key of FIELD_KEYS) {
    if (key === "whose" && MIXED_TABLES.has(tableName)) {
      continue;
    }
    const values = fieldMaps.map((fields) => fields[key]);
    const first = values[0];
    if (first === undefined) {
      continue;
    }
    if (values.every((value) => stableEqual(value, first))) {
      defaults[key] = first;
    }
  }

  return defaults;
}

function columnOverride(
  entry: FlatEntry,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const fields = pickFields(entry);
  const override: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) {
    if (!(key in fields)) {
      continue;
    }
    if (!stableEqual(fields[key], defaults[key])) {
      override[key] = fields[key];
    }
  }
  return override;
}

export function convertFlatToGrouped(flatYaml: string): string {
  const entries = parse(flatYaml) as FlatEntry[];
  const byTable = new Map<string, FlatEntry[]>();
  const otherItems: FlatEntry[] = [];

  for (const entry of entries) {
    if (typeof entry.table === "string" && typeof entry.column === "string") {
      const list = byTable.get(entry.table) ?? [];
      list.push(entry);
      byTable.set(entry.table, list);
    } else {
      otherItems.push(entry);
    }
  }

  const d1Tables: Record<
    string,
    { defaults?: Record<string, unknown>; columns: Record<string, unknown> }
  > = {};

  for (const [tableName, rows] of [...byTable.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    rows.sort((a, b) => String(a.column).localeCompare(String(b.column)));
    const defaults = computeDefaults(tableName, rows);
    const columns: Record<string, unknown> = {};
    for (const row of rows) {
      columns[String(row.column)] = columnOverride(row, defaults);
    }
    const table: {
      defaults?: Record<string, unknown>;
      columns: Record<string, unknown>;
    } = {
      columns,
    };
    if (Object.keys(defaults).length > 0) {
      table.defaults = defaults;
    }
    d1Tables[tableName] = table;
  }

  const other_items = otherItems
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => {
      const out: Record<string, unknown> = { id: item.id };
      for (const key of [
        "binding",
        "whose",
        "data",
        "purpose",
        "processors",
        "retention",
        "storage",
        "who_can_see",
        "source",
        "verified",
        "notes",
      ]) {
        if (key in item) {
          out[key] = item[key];
        }
      }
      return out;
    });

  const grouped = {
    schema_version: 1,
    d1_tables: d1Tables,
    other_items,
  };

  return `# Generated from data-map.flat.yml by flat-to-grouped.ts (test fixture only)\n${stringify(grouped)}`;
}
