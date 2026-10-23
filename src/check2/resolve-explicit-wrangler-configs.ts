import { statSync } from "node:fs";
import { basename } from "node:path";
import { fatal, type FatalError } from "../findings.js";
import { isWranglerConfigBasename } from "./discover-wrangler-configs.js";

function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function formatErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export type ResolveExplicitWranglerConfigsResult =
  { ok: true; configPaths: string[] } | { ok: false; fatal: FatalError };

/**
 * Validates explicit Wrangler config paths (absolute) and returns them sorted.
 */
export function resolveExplicitWranglerConfigPaths(
  paths: readonly string[],
): ResolveExplicitWranglerConfigsResult {
  const sorted = [...paths].sort(compareCodeUnits);
  for (const configPath of sorted) {
    const base = basename(configPath);
    if (!isWranglerConfigBasename(base)) {
      return {
        ok: false,
        fatal: fatal(
          configPath,
          `Wrangler config path must be named wrangler.json or wrangler.jsonc (got \`${base}\`)`,
        ),
      };
    }
    try {
      const st = statSync(configPath);
      if (!st.isFile()) {
        return {
          ok: false,
          fatal: fatal(configPath, `Wrangler config path is not a file: ${configPath}`),
        };
      }
    } catch (err) {
      return {
        ok: false,
        fatal: fatal(
          configPath,
          `cannot read Wrangler config \`${configPath}\`: ${formatErr(err)}`,
        ),
      };
    }
  }
  return { ok: true, configPaths: sorted };
}
