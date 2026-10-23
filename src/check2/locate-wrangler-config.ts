import { readdirSync } from "node:fs";
import { fatal, type FatalError } from "../findings.js";
import { resolveWranglerConfigInDir } from "./resolve-wrangler-config-in-dir.js";

export type WranglerConfigFs = {
  readdirSync(path: string): string[];
};

const defaultFs: WranglerConfigFs = {
  readdirSync(path) {
    return readdirSync(path);
  },
};

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

export type LocateWranglerConfigResult =
  | { ok: true; kind: "config"; configPath: string; skippedConfigPath?: string }
  | { ok: true; kind: "nothing" }
  | { ok: false; fatal: FatalError }
  | { ok: false; kind: "toml_only"; tomlPath: string };

/**
 * Resolves `wrangler.json`, then `wrangler.jsonc`, in `wranglerDir` (Wrangler order).
 * TOML-only is reported separately so callers can return a Check 2 fatal.
 */
export function locateWranglerConfig(
  wranglerDir: string,
  fs: WranglerConfigFs = defaultFs,
): LocateWranglerConfigResult {
  let names: string[];
  try {
    names = fs.readdirSync(wranglerDir);
  } catch (err) {
    if (isMissingDirError(err)) {
      return {
        ok: false,
        fatal: fatal(
          wranglerDir,
          `Wrangler directory not found or not a directory: ${wranglerDir}; check the \`wrangler\` path`,
        ),
      };
    }
    return {
      ok: false,
      fatal: fatal(
        wranglerDir,
        `cannot read Wrangler directory \`${wranglerDir}\`: ${formatErr(err)}`,
      ),
    };
  }

  const resolved = resolveWranglerConfigInDir(wranglerDir, names);
  if (resolved.kind === "config") {
    return {
      ok: true,
      kind: "config",
      configPath: resolved.configPath,
      skippedConfigPath: resolved.skippedConfigPath,
    };
  }
  if (resolved.kind === "toml_only") {
    return { ok: false, kind: "toml_only", tomlPath: resolved.tomlPath };
  }
  return { ok: true, kind: "nothing" };
}
