import type { AggregatedBinding, BindingKind, BindingOccurrence } from "./types.js";

function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readBindingString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function extractFromSection(
  sectionRoot: Record<string, unknown>,
  sectionLabel: string,
  pathPrefix: string,
  occurrences: BindingOccurrence[],
  d1Counts: { section: string; count: number; path: string }[],
): void {
  const d1 = sectionRoot.d1_databases;
  if (Array.isArray(d1)) {
    let d1BindingCount = 0;
    for (let i = 0; i < d1.length; i++) {
      const entry = d1[i];
      if (!isRecord(entry)) {
        continue;
      }
      const binding = readBindingString(entry, "binding");
      if (binding) {
        d1BindingCount++;
        occurrences.push({
          name: binding,
          kind: "d1",
          section: sectionLabel,
          jsonPath: `${pathPrefix}d1_databases[${i}].binding`,
        });
      }
    }
    if (d1BindingCount > 1) {
      d1Counts.push({
        section: sectionLabel,
        count: d1BindingCount,
        path: `${pathPrefix}d1_databases`,
      });
    }
  }

  const r2 = sectionRoot.r2_buckets;
  if (Array.isArray(r2)) {
    for (let i = 0; i < r2.length; i++) {
      const entry = r2[i];
      if (!isRecord(entry)) {
        continue;
      }
      const binding = readBindingString(entry, "binding");
      if (binding) {
        occurrences.push({
          name: binding,
          kind: "r2",
          section: sectionLabel,
          jsonPath: `${pathPrefix}r2_buckets[${i}].binding`,
        });
      }
    }
  }

  const kv = sectionRoot.kv_namespaces;
  if (Array.isArray(kv)) {
    for (let i = 0; i < kv.length; i++) {
      const entry = kv[i];
      if (!isRecord(entry)) {
        continue;
      }
      const binding = readBindingString(entry, "binding");
      if (binding) {
        occurrences.push({
          name: binding,
          kind: "kv",
          section: sectionLabel,
          jsonPath: `${pathPrefix}kv_namespaces[${i}].binding`,
        });
      }
    }
  }

  const queues = sectionRoot.queues;
  if (isRecord(queues)) {
    const producers = queues.producers;
    if (Array.isArray(producers)) {
      for (let i = 0; i < producers.length; i++) {
        const entry = producers[i];
        if (!isRecord(entry)) {
          continue;
        }
        const binding = readBindingString(entry, "binding");
        if (binding) {
          occurrences.push({
            name: binding,
            kind: "queue",
            section: sectionLabel,
            jsonPath: `${pathPrefix}queues.producers[${i}].binding`,
          });
        }
      }
    }
  }

  const images = sectionRoot.images;
  if (isRecord(images)) {
    const binding = readBindingString(images, "binding");
    if (binding) {
      occurrences.push({
        name: binding,
        kind: "images",
        section: sectionLabel,
        jsonPath: `${pathPrefix}images.binding`,
      });
    }
  }
}

export type ExtractBindingsResult = {
  bindings: AggregatedBinding[];
  multipleD1Sections: readonly { section: string; path: string; count: number }[];
};

export function extractBindings(root: Record<string, unknown>): ExtractBindingsResult {
  const occurrences: BindingOccurrence[] = [];
  const d1Counts: { section: string; count: number; path: string }[] = [];

  extractFromSection(root, "top level", "", occurrences, d1Counts);

  const env = root.env;
  if (isRecord(env)) {
    for (const envName of Object.keys(env).sort(compareCodeUnits)) {
      const block = env[envName];
      if (isRecord(block)) {
        extractFromSection(
          block,
          `env.${envName}`,
          `env.${envName}.`,
          occurrences,
          d1Counts,
        );
      }
    }
  }

  const previews = root.previews;
  if (isRecord(previews)) {
    extractFromSection(previews, "previews", "previews.", occurrences, d1Counts);
  }

  const byName = new Map<
    string,
    { kind: BindingKind; sections: Set<string>; paths: string[] }
  >();
  for (const occ of occurrences) {
    let entry = byName.get(occ.name);
    if (!entry) {
      entry = { kind: occ.kind, sections: new Set(), paths: [] };
      byName.set(occ.name, entry);
    }
    entry.sections.add(occ.section);
    entry.paths.push(occ.jsonPath);
  }

  const bindings: AggregatedBinding[] = [];
  for (const name of [...byName.keys()].sort(compareCodeUnits)) {
    const entry = byName.get(name)!;
    const sections = [...entry.sections].sort(compareCodeUnits);
    const jsonPath = [...entry.paths].sort(compareCodeUnits)[0];
    bindings.push({
      name,
      kind: entry.kind,
      sections,
      jsonPath,
    });
  }

  const multipleD1Sections = d1Counts
    .filter((d) => d.count > 1)
    .sort((a, b) => compareCodeUnits(a.section, b.section));

  return { bindings, multipleD1Sections };
}
