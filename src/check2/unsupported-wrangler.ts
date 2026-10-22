/** ADR 0003 — deferred multi-D1 / Durable Objects proposals and interim fail-loud rule. */
export const ADR_0003_UNSUPPORTED_WRANGLER_URL =
  "https://github.com/didi-build/nodrift/blob/main/docs/decisions/0003-nodrift-v1-design.md#proposed-changes-for-maintainer-review";

function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** Formats binding names for diagnostics, e.g. `A` and `B` or `A`, `B`, and `C`. */
export function formatBindingNameList(names: readonly string[]): string {
  const sorted = [...names].sort(compareCodeUnits);
  const quoted = sorted.map((name) => `\`${name}\``);
  if (quoted.length === 1) {
    return quoted[0];
  }
  if (quoted.length === 2) {
    return `${quoted[0]} and ${quoted[1]}`;
  }
  const last = quoted[quoted.length - 1];
  const rest = quoted.slice(0, -1).join(", ");
  return `${rest}, and ${last}`;
}

export function unsupportedWranglerFix(): string {
  return `remove or consolidate unsupported bindings until nodrift adds support (see ADR 0003: ${ADR_0003_UNSUPPORTED_WRANGLER_URL})`;
}
