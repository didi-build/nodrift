import type {
  ColumnOverride,
  DataMap,
  ExpandedEntry,
  Sourced,
  TableDefaults,
} from "./types.js";

function sourceField<T>(
  tablePath: string,
  columnPath: string,
  field: string,
  defaults: TableDefaults | undefined,
  override: ColumnOverride,
): Sourced<T> | undefined {
  if (field in override) {
    const value = (override as Record<string, T | undefined>)[field];
    if (value !== undefined) {
      return { value, path: `${columnPath}.${field}` };
    }
  }
  if (defaults && field in defaults) {
    const value = (defaults as Record<string, T | undefined>)[field];
    if (value !== undefined) {
      return { value, path: `${tablePath}.defaults.${field}` };
    }
  }
  return undefined;
}

/**
 * Returns one effective entry per D1 column and per `other_item`, with defaults merged.
 * D1 columns that fail validation because `whose` is missing are omitted; callers must
 * stop on loader findings before comparing expanded output to expectations.
 */
export function expandDataMap(map: DataMap): ExpandedEntry[] {
  const entries: ExpandedEntry[] = [];

  for (const [tableName, table] of Object.entries(map.d1_tables)) {
    const tablePath = `d1_tables.${tableName}`;
    for (const [columnName, override] of Object.entries(table.columns)) {
      const columnPath = `${tablePath}.columns.${columnName}`;
      const whose = sourceField<string>(
        tablePath,
        columnPath,
        "whose",
        table.defaults,
        override,
      );
      if (!whose) {
        continue;
      }

      const entry = {
        kind: "d1_column" as const,
        id: `${tableName}.${columnName}`,
        table: tableName,
        column: columnName,
        whose,
        data: sourceField<string>(
          tablePath,
          columnPath,
          "data",
          table.defaults,
          override,
        ),
        purpose: sourceField<string>(
          tablePath,
          columnPath,
          "purpose",
          table.defaults,
          override,
        ),
        storage: sourceField<string>(
          tablePath,
          columnPath,
          "storage",
          table.defaults,
          override,
        ),
        processors: sourceField<string[]>(
          tablePath,
          columnPath,
          "processors",
          table.defaults,
          override,
        ),
        retention: sourceField<string>(
          tablePath,
          columnPath,
          "retention",
          table.defaults,
          override,
        ),
        who_can_see: sourceField<string>(
          tablePath,
          columnPath,
          "who_can_see",
          table.defaults,
          override,
        ),
        source: sourceField<string>(
          tablePath,
          columnPath,
          "source",
          table.defaults,
          override,
        ),
        verified: sourceField<boolean>(
          tablePath,
          columnPath,
          "verified",
          table.defaults,
          override,
        ),
        notes: sourceField<string>(
          tablePath,
          columnPath,
          "notes",
          table.defaults,
          override,
        ),
      };
      entries.push(entry);
    }
  }

  for (const item of map.other_items) {
    const basePath = `other_items.${item.id}`;
    entries.push({
      kind: "other_item",
      id: item.id,
      whose: { value: item.whose, path: `${basePath}.whose` },
      data: { value: item.data, path: `${basePath}.data` },
      purpose: { value: item.purpose, path: `${basePath}.purpose` },
      processors: { value: item.processors, path: `${basePath}.processors` },
      retention: { value: item.retention, path: `${basePath}.retention` },
      binding:
        item.binding !== undefined
          ? { value: item.binding, path: `${basePath}.binding` }
          : undefined,
      storage:
        item.storage !== undefined
          ? { value: item.storage, path: `${basePath}.storage` }
          : undefined,
      who_can_see:
        item.who_can_see !== undefined
          ? { value: item.who_can_see, path: `${basePath}.who_can_see` }
          : undefined,
      source:
        item.source !== undefined
          ? { value: item.source, path: `${basePath}.source` }
          : undefined,
      verified:
        item.verified !== undefined
          ? { value: item.verified, path: `${basePath}.verified` }
          : undefined,
      notes:
        item.notes !== undefined
          ? { value: item.notes, path: `${basePath}.notes` }
          : undefined,
    });
  }

  entries.sort((a, b) => {
    if (a.id < b.id) {
      return -1;
    }
    if (a.id > b.id) {
      return 1;
    }
    return 0;
  });
  return entries;
}
