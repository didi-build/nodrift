import type { BindingKind, BindingLocation, CollectedBinding } from "./types.js";

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
  value: unknown,
  path: string,
): { ok: true; binding: string } | { ok: false; path: string } {
  if (typeof value === "string" && value.length > 0) {
    return { ok: true, binding: value };
  }
  return { ok: false, path };
}

type MutableBinding = {
  kind: BindingKind;
  locations: BindingLocation[];
};

export type MultipleD1InSection = {
  section: string;
  /** Path to the section's `d1_databases` array, e.g. `env.staging.d1_databases`. */
  d1ArrayPath: string;
  bindingCount: number;
};

function collectFromSection(
  sectionObj: Record<string, unknown>,
  sectionLabel: string,
  pathPrefix: string,
  bindings: Map<string, MutableBinding>,
  multipleD1: MultipleD1InSection[],
): void {
  let d1BindingCount = 0;

  const d1 = sectionObj.d1_databases;
  if (Array.isArray(d1)) {
    for (let i = 0; i < d1.length; i++) {
      const entry = d1[i];
      if (!isRecord(entry)) {
        continue;
      }
      const path = `${pathPrefix}d1_databases[${i}].binding`;
      const read = readBindingString(entry.binding, path);
      if (read.ok) {
        d1BindingCount += 1;
        addBinding(bindings, read.binding, "d1", sectionLabel, path);
      }
    }
    if (d1BindingCount > 1) {
      multipleD1.push({
        section: sectionLabel,
        d1ArrayPath: `${pathPrefix}d1_databases`,
        bindingCount: d1BindingCount,
      });
    }
  }

  const r2 = sectionObj.r2_buckets;
  if (Array.isArray(r2)) {
    for (let i = 0; i < r2.length; i++) {
      const entry = r2[i];
      if (!isRecord(entry)) {
        continue;
      }
      const path = `${pathPrefix}r2_buckets[${i}].binding`;
      const read = readBindingString(entry.binding, path);
      if (read.ok) {
        addBinding(bindings, read.binding, "r2", sectionLabel, path);
      }
    }
  }

  const kv = sectionObj.kv_namespaces;
  if (Array.isArray(kv)) {
    for (let i = 0; i < kv.length; i++) {
      const entry = kv[i];
      if (!isRecord(entry)) {
        continue;
      }
      const path = `${pathPrefix}kv_namespaces[${i}].binding`;
      const read = readBindingString(entry.binding, path);
      if (read.ok) {
        addBinding(bindings, read.binding, "kv", sectionLabel, path);
      }
    }
  }

  const queues = sectionObj.queues;
  if (isRecord(queues)) {
    const producers = queues.producers;
    if (Array.isArray(producers)) {
      for (let i = 0; i < producers.length; i++) {
        const entry = producers[i];
        if (!isRecord(entry)) {
          continue;
        }
        const path = `${pathPrefix}queues.producers[${i}].binding`;
        const read = readBindingString(entry.binding, path);
        if (read.ok) {
          addBinding(bindings, read.binding, "queue", sectionLabel, path);
        }
      }
    }
  }

  const images = sectionObj.images;
  if (isRecord(images)) {
    const path = `${pathPrefix}images.binding`;
    const read = readBindingString(images.binding, path);
    if (read.ok) {
      addBinding(bindings, read.binding, "images", sectionLabel, path);
    }
  }
}

function addBinding(
  bindings: Map<string, MutableBinding>,
  name: string,
  kind: BindingKind,
  section: string,
  path: string,
): void {
  const existing = bindings.get(name);
  if (!existing) {
    bindings.set(name, {
      kind,
      locations: [{ section, path }],
    });
    return;
  }
  if (existing.kind !== kind) {
    // Same name with different kinds is invalid Wrangler config; keep first kind.
  }
  const hasSection = existing.locations.some((loc) => loc.section === section);
  if (!hasSection) {
    existing.locations.push({ section, path });
  }
}

function sortLocations(locations: BindingLocation[]): BindingLocation[] {
  return [...locations].sort((a, b) => {
    const bySection = compareCodeUnits(a.section, b.section);
    if (bySection !== 0) {
      return bySection;
    }
    return compareCodeUnits(a.path, b.path);
  });
}

export type ExtractBindingsResult = {
  bindings: CollectedBinding[];
  multipleD1InSection: MultipleD1InSection[];
};

/**
 * Collects in-scope Wrangler bindings from the top level, each `env.<name>` block, and `previews`.
 */
export function extractBindings(
  config: Record<string, unknown>,
): ExtractBindingsResult {
  const map = new Map<string, MutableBinding>();
  const multipleD1: MultipleD1InSection[] = [];

  collectFromSection(config, "top level", "", map, multipleD1);

  const env = config.env;
  if (isRecord(env)) {
    const envBlocks: { name: string; block: Record<string, unknown> }[] = [];
    const envNames = Object.getOwnPropertyNames(env).sort(compareCodeUnits);
    for (const envName of envNames) {
      if (!Object.hasOwn(env, envName)) {
        continue;
      }
      const block = env[envName];
      if (isRecord(block)) {
        envBlocks.push({ name: envName, block });
      }
    }
    const proto = Object.getPrototypeOf(env);
    if (isRecord(proto) && proto !== Object.prototype) {
      const hasProtoBlock = envBlocks.some((entry) => entry.name === "__proto__");
      if (!hasProtoBlock) {
        envBlocks.push({ name: "__proto__", block: proto });
      }
    }
    envBlocks.sort((a, b) => compareCodeUnits(a.name, b.name));
    for (const { name, block } of envBlocks) {
      collectFromSection(block, `env.${name}`, `env.${name}.`, map, multipleD1);
    }
  }

  const previews = config.previews;
  if (isRecord(previews)) {
    collectFromSection(previews, "previews", "previews.", map, multipleD1);
  }

  const bindings: CollectedBinding[] = [];
  const names = [...map.keys()].sort(compareCodeUnits);
  for (const name of names) {
    const entry = map.get(name);
    if (!entry) {
      continue;
    }
    bindings.push({
      name,
      kind: entry.kind,
      locations: sortLocations(entry.locations),
    });
  }

  multipleD1.sort((a, b) => compareCodeUnits(a.section, b.section));

  return { bindings, multipleD1InSection: multipleD1 };
}
