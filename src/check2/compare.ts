import type { ExpandedEntry } from "../data-map/types.js";
import { finding, type Finding } from "../findings.js";
import type { AggregatedBinding, BindingKind } from "./types.js";

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
    return "\uFFFF";
  }
  return section;
}

function formatSections(sections: readonly string[]): string {
  const sorted = [...sections].sort((a, b) =>
    compareCodeUnits(sectionSortKey(a), sectionSortKey(b)),
  );
  if (sorted.length === 1) {
    return sorted[0];
  }
  if (sorted.length === 2) {
    return `${sorted[0]} and ${sorted[1]}`;
  }
  const last = sorted[sorted.length - 1];
  const rest = sorted.slice(0, -1).join(", ");
  return `${rest}, and ${last}`;
}

function bindingFixSnippet(kind: BindingKind, bindingName: string): string {
  const id = `${kind}.${bindingName.toLowerCase()}`;
  return `other_items:
  - id: ${id}
    binding: ${bindingName}
    whose: TODO
    data: TODO
    purpose: TODO
    processors: [Cloudflare]
    retention: TODO`;
}

function collectCoveredBindings(expanded: readonly ExpandedEntry[]): Set<string> {
  const covered = new Set<string>();
  for (const entry of expanded) {
    if (entry.kind !== "other_item" || entry.binding === undefined) {
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

export type CompareInput = {
  bindings: readonly AggregatedBinding[];
  multipleD1Sections: readonly { section: string; path: string; count: number }[];
  expanded: readonly ExpandedEntry[];
  wranglerConfigPath: string;
};

export function compareBindingsToMap(input: CompareInput): Finding[] {
  const { bindings, multipleD1Sections, expanded, wranglerConfigPath } = input;
  const covered = collectCoveredBindings(expanded);
  const findings: Finding[] = [];

  for (const section of multipleD1Sections) {
    findings.push(
      finding(
        wranglerConfigPath,
        section.path,
        "multiple_d1_databases",
        `section \`${section.section}\` declares ${section.count} D1 database bindings; v1 supports one D1 database per section`,
        "Use a single `d1_databases` entry per section, or split databases across v2 when multi-database support lands.",
      ),
    );
  }

  const uncovered = bindings.filter((b) => !covered.has(b.name));
  uncovered.sort((a, b) => {
    const byName = compareCodeUnits(a.name, b.name);
    if (byName !== 0) {
      return byName;
    }
    const aSection = [...a.sections].sort(compareCodeUnits)[0] ?? "";
    const bSection = [...b.sections].sort(compareCodeUnits)[0] ?? "";
    return compareCodeUnits(aSection, bSection);
  });

  for (const binding of uncovered) {
    const sectionsText = formatSections(binding.sections);
    findings.push(
      finding(
        wranglerConfigPath,
        binding.jsonPath,
        "binding_not_in_map",
        `binding \`${binding.name}\` (${kindLabel(binding.kind)}) is declared in ${sectionsText} but not listed on any \`other_items\` entry \`binding:\``,
        bindingFixSnippet(binding.kind, binding.name),
      ),
    );
  }

  const d1Findings = findings.filter((f) => f.code === "multiple_d1_databases");
  const bindingFindings = findings.filter((f) => f.code === "binding_not_in_map");
  d1Findings.sort((a, b) => compareCodeUnits(a.message, b.message));
  bindingFindings.sort((a, b) => {
    const aBinding = /^binding `([^`]+)`/.exec(a.message)?.[1] ?? "";
    const bBinding = /^binding `([^`]+)`/.exec(b.message)?.[1] ?? "";
    const byBinding = compareCodeUnits(aBinding, bBinding);
    if (byBinding !== 0) {
      return byBinding;
    }
    return compareCodeUnits(a.path, b.path);
  });

  return [...d1Findings, ...bindingFindings];
}
