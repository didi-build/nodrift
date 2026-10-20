import type { ExpandedEntry } from "../data-map/types.js";
import { finding, type Finding } from "../findings.js";
import type { CollectedBinding } from "./types.js";
import type { MultipleD1InSection } from "./extract-bindings.js";
import type { BindingKind, BindingLocation } from "./types.js";

function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function kindLabel(kind: BindingKind): string {
  switch (kind) {
    case "d1":
      return "D1";
    case "r2":
      return "R2";
    case "kv":
      return "KV";
    case "queue":
      return "queue";
    case "images":
      return "Images";
  }
}

function sectionSortKey(section: string): string {
  if (section === "top level") {
    return "\u0000";
  }
  if (section === "previews") {
    return "\u0001";
  }
  return section;
}

function sectionPriority(section: string): number {
  if (section === "top level") {
    return 0;
  }
  if (section === "previews") {
    return 2;
  }
  return 1;
}

function sortSections(sections: string[]): string[] {
  return [...new Set(sections)].sort((a, b) =>
    compareCodeUnits(sectionSortKey(a), sectionSortKey(b)),
  );
}

function formatSections(sections: string[]): string {
  const unique = sortSections(sections);
  if (unique.length === 1) {
    return unique[0];
  }
  if (unique.length === 2) {
    return `${unique[0]} and ${unique[1]}`;
  }
  const last = unique[unique.length - 1];
  const rest = unique.slice(0, -1).join(", ");
  return `${rest}, and ${last}`;
}

function primaryBindingPath(locations: readonly BindingLocation[]): string {
  const sorted = [...locations].sort((a, b) => {
    const byPriority = sectionPriority(a.section) - sectionPriority(b.section);
    if (byPriority !== 0) {
      return byPriority;
    }
    const bySection = compareCodeUnits(a.section, b.section);
    if (bySection !== 0) {
      return bySection;
    }
    return compareCodeUnits(a.path, b.path);
  });
  return sorted[0]?.path ?? "";
}

function suggestedItemId(kind: BindingKind, bindingName: string): string {
  return `${kind}.${bindingName.toLowerCase()}`;
}

function bindingNotInMapFix(kind: BindingKind, bindingName: string): string {
  const id = suggestedItemId(kind, bindingName);
  return `other_items:
  - id: ${id}
    binding: ${bindingName}
    whose: TODO
    data: TODO
    purpose: TODO
    processors: [Cloudflare]
    retention: TODO`;
}

export function collectCoveredBindings(entries: ExpandedEntry[]): Set<string> {
  const covered = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "other_item" || !entry.binding) {
      continue;
    }
    const value = entry.binding.value;
    if (typeof value === "string") {
      covered.add(value);
    } else {
      for (const name of value) {
        covered.add(name);
      }
    }
  }
  return covered;
}

export function formatMapBindingNames(covered: ReadonlySet<string>): string {
  return [...covered].sort(compareCodeUnits).join(", ");
}

/**
 * Pure comparison of Wrangler bindings to `other_items` `binding:` coverage.
 */
export function compareBindingsToMap(
  bindings: readonly CollectedBinding[],
  covered: ReadonlySet<string>,
  configFile: string,
  multipleD1InSection: readonly MultipleD1InSection[],
): Finding[] {
  const findings: Finding[] = [];

  for (const multi of multipleD1InSection) {
    findings.push(
      finding(
        configFile,
        multi.d1ArrayPath,
        "multiple_d1_databases",
        `section \`${multi.section}\` declares ${multi.bindingCount} D1 database bindings; v1 supports one D1 database per section`,
        "declare at most one `d1_databases` entry per Wrangler config section",
      ),
    );
  }

  for (const binding of bindings) {
    if (covered.has(binding.name)) {
      continue;
    }
    const sections = formatSections(binding.locations.map((loc) => loc.section));
    const primaryPath = primaryBindingPath(binding.locations);
    findings.push(
      finding(
        configFile,
        primaryPath,
        "binding_not_in_map",
        `binding \`${binding.name}\` (${kindLabel(binding.kind)}) declared in ${sections} is not listed on any \`other_items\` entry \`binding:\``,
        bindingNotInMapFix(binding.kind, binding.name),
      ),
    );
  }

  return findings;
}
