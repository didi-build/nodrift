import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, normalize } from "node:path";
import { fatal, type FatalError } from "../findings.js";
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

function isPermissionError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EACCES" || code === "EPERM";
  }
  return false;
}

function formatErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export type DiscoverWranglerFs = {
  readdirSync(path: string): string[];
  lstatSync(path: string): { isDirectory(): boolean; isSymbolicLink(): boolean };
  realpathSync(path: string): string;
};

const defaultDiscoverFs: DiscoverWranglerFs = {
  readdirSync(path) {
    return readdirSync(path);
  },
  lstatSync(path) {
    return lstatSync(path);
  },
  realpathSync(path) {
    return realpathSync(path);
  },
};

export type DiscoverWranglerConfigsResult =
  | {
      ok: true;
      configPaths: string[];
      skippedTomlPaths: string[];
      skippedUnreadableDirs: string[];
    }
  | { ok: false; fatal: FatalError };

function canonicalPath(path: string, fs: DiscoverWranglerFs): string {
  try {
    return fs.realpathSync(path);
  } catch {
    return normalize(path);
  }
}

function missingSearchRootFatal(searchRoot: string): FatalError {
  return fatal(
    searchRoot,
    `Wrangler directory not found or not a directory: ${searchRoot}; check the \`wrangler\` path`,
  );
}

/**
 * Walks `searchRoot` and returns one JSON/JSONC config path per directory (deduped by real path).
 * Does not follow symbolic links. Every `wrangler.toml` path is listed in `skippedTomlPaths`.
 */
export function discoverWranglerConfigPaths(
  searchRoot: string,
  fs: DiscoverWranglerFs = defaultDiscoverFs,
): DiscoverWranglerConfigsResult {
  const configPaths: string[] = [];
  const skippedTomlPaths: string[] = [];
  const skippedUnreadableDirs: string[] = [];
  const seenUnreadableDirs = new Set<string>();
  const seenConfigCanonical = new Set<string>();

  function noteUnreadableDir(dirPath: string): void {
    const canon = canonicalPath(dirPath, fs);
    if (seenUnreadableDirs.has(canon)) {
      return;
    }
    seenUnreadableDirs.add(canon);
    skippedUnreadableDirs.push(dirPath);
  }

  function addConfig(configPath: string): void {
    const canon = canonicalPath(configPath, fs);
    if (seenConfigCanonical.has(canon)) {
      return;
    }
    seenConfigCanonical.add(canon);
    configPaths.push(configPath);
  }

  function walk(dir: string): DiscoverWranglerConfigsResult {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch (err) {
      if (dir === searchRoot) {
        if (isMissingDirError(err)) {
          return { ok: false, fatal: missingSearchRootFatal(searchRoot) };
        }
        return {
          ok: false,
          fatal: fatal(
            searchRoot,
            `cannot read Wrangler directory \`${searchRoot}\`: ${formatErr(err)}`,
          ),
        };
      }
      if (isMissingDirError(err)) {
        return {
          ok: false,
          fatal: fatal(
            dir,
            `cannot read directory \`${dir}\` while discovering Wrangler configs: ${formatErr(err)}`,
          ),
        };
      }
      if (isPermissionError(err)) {
        noteUnreadableDir(dir);
        return { ok: true, configPaths, skippedTomlPaths, skippedUnreadableDirs };
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
      addConfig(resolved.configPath);
    }

    for (const name of names) {
      if (WRANGLER_DISCOVERY_SKIP_DIRS.has(name)) {
        continue;
      }
      const child = join(dir, name);
      let lst;
      try {
        lst = fs.lstatSync(child);
      } catch (err) {
        if (isMissingDirError(err)) {
          continue;
        }
        if (isPermissionError(err)) {
          noteUnreadableDir(child);
          continue;
        }
        continue;
      }
      if (lst.isSymbolicLink()) {
        continue;
      }
      if (!lst.isDirectory()) {
        continue;
      }
      const childResult = walk(child);
      if (!childResult.ok) {
        return childResult;
      }
    }

    return { ok: true, configPaths, skippedTomlPaths, skippedUnreadableDirs };
  }

  const walked = walk(searchRoot);
  if (!walked.ok) {
    return walked;
  }

  configPaths.sort(compareCodeUnits);
  skippedTomlPaths.sort(compareCodeUnits);
  skippedUnreadableDirs.sort(compareCodeUnits);
  return { ok: true, configPaths, skippedTomlPaths, skippedUnreadableDirs };
}

const WRANGLER_CONFIG_BASENAMES = new Set(["wrangler.json", "wrangler.jsonc"]);

export function isWranglerConfigBasename(name: string): boolean {
  return WRANGLER_CONFIG_BASENAMES.has(name);
}
