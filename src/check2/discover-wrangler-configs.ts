import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fatal, type FatalError } from "../findings.js";
import type { WranglerConfigFs } from "./locate-wrangler-config.js";
import { resolveWranglerConfigInDir } from "./resolve-wrangler-config-in-dir.js";
import { WRANGLER_DISCOVERY_SKIP_DIRS } from "./wrangler-skip-dirs.js";

function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function isMissingDirError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
  return false;
}

function formatErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export type DiscoverWranglerFs = WranglerConfigFs & {
  statSync(path: string): { isDirectory(): boolean };
};

const defaultDiscoverFs: DiscoverWranglerFs = {
  readdirSync(path) {
    return readdirSync(path);
  },
  statSync(path) {
    return statSync(path);
  },
};

export type DiscoverWranglerConfigsResult =
  | { ok: true; configPaths: string[]; skippedTomlPaths: string[] }
  | { ok: false; fatal: FatalError };

/**
 * Walks `searchRoot` and returns one JSON/JSONC config path per directory that contains one.
 * Every `wrangler.toml` found is listed in `skippedTomlPaths` for warning output.
 */
export function discoverWranglerConfigPaths(
  searchRoot: string,
  fs: DiscoverWranglerFs = defaultDiscoverFs,
): DiscoverWranglerConfigsResult {
  const configPaths: string[] = [];
  const skippedTomlPaths: string[] = [];

  function walk(dir: string): DiscoverWranglerConfigsResult {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch (err) {
      if (isMissingDirError(err)) {
        return {
          ok: false,
          fatal: fatal(
            searchRoot,
            `Wrangler search path not found or not a directory: ${searchRoot}; check the \`wrangler\` path`,
          ),
        };
      }
      return {
        ok: false,
        fatal: fatal(
          dir,
          `cannot read directory \`${dir}\` while discovering Wrangler configs: ${formatErr(err)}`,
        ),
      };
    }

    if (names.includes("wrangler.toml")) {
      skippedTomlPaths.push(join(dir, "wrangler.toml"));
    }

    const resolved = resolveWranglerConfigInDir(dir, names);
    if (resolved.kind === "config") {
      configPaths.push(resolved.configPath);
    }

    for (const name of names) {
      if (WRANGLER_DISCOVERY_SKIP_DIRS.has(name)) {
        continue;
      }
      const child = join(dir, name);
      let st;
      try {
        st = fs.statSync(child);
      } catch {
        continue;
      }
      if (!st.isDirectory()) {
        continue;
      }
      const childResult = walk(child);
      if (!childResult.ok) {
        return childResult;
      }
    }

    return { ok: true, configPaths, skippedTomlPaths };
  }

  const walked = walk(searchRoot);
  if (!walked.ok) {
    return walked;
  }

  configPaths.sort(compareCodeUnits);
  skippedTomlPaths.sort(compareCodeUnits);
  return { ok: true, configPaths, skippedTomlPaths };
}

const WRANGLER_CONFIG_BASENAMES = new Set(["wrangler.json", "wrangler.jsonc"]);

export function isWranglerConfigBasename(name: string): boolean {
  return WRANGLER_CONFIG_BASENAMES.has(name);
}
