import { realpathSync, statSync } from "node:fs";
import { basename, normalize } from "node:path";
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

function canonicalConfigPath(configPath: string): string {
  try {
    return realpathSync(configPath);
  } catch {
    return normalize(configPath);
  }
}

export type ResolveExplicitWranglerConfigsResult =
  { ok: true; configPaths: string[] } | { ok: false; fatal: FatalError };

/**
 * Validates explicit Wrangler config paths (absolute), dedupes equivalent paths, and returns
 * paths sorted by code-unit order (first occurrence wins).
 */
export function resolveExplicitWranglerConfigPaths(
  paths: readonly string[],
): ResolveExplicitWranglerConfigsResult {
  const seenCanonical = new Set<string>();
  const ordered: string[] = [];

  for (const configPath of paths) {
    const canonical = canonicalConfigPath(configPath);
    if (seenCanonical.has(canonical)) {
      continue;
    }
    seenCanonical.add(canonical);

    const base = basename(configPath);
    if (base === "wrangler.toml") {
      return {
        ok: false,
        fatal: fatal(
          configPath,
          "`wrangler.toml` is not supported in v1; use `wrangler.jsonc`",
        ),
      };
    }
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
      if (st.isDirectory()) {
        return {
          ok: false,
          fatal: fatal(configPath, `Wrangler config path is not a file: ${configPath}`),
        };
      }
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
    ordered.push(configPath);
  }

  ordered.sort(compareCodeUnits);
  return { ok: true, configPaths: ordered };
}
