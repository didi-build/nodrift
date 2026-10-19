import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fatal, type FatalError } from "../findings.js";

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
  | { ok: true; kind: "config"; configPath: string }
  | { ok: true; kind: "nothing" }
  | { ok: false; fatal: FatalError }
  | { ok: false; kind: "toml_only"; tomlPath: string };

/**
 * Resolves `wrangler.jsonc`, then `wrangler.json`, in `wranglerDir`.
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
      return { ok: true, kind: "nothing" };
    }
    return {
      ok: false,
      fatal: fatal(
        wranglerDir,
        `cannot read Wrangler directory \`${wranglerDir}\`: ${formatErr(err)}`,
      ),
    };
  }

  const hasJsonc = names.includes("wrangler.jsonc");
  const hasJson = names.includes("wrangler.json");
  const hasToml = names.includes("wrangler.toml");

  if (hasJsonc) {
    return {
      ok: true,
      kind: "config",
      configPath: join(wranglerDir, "wrangler.jsonc"),
    };
  }
  if (hasJson) {
    return {
      ok: true,
      kind: "config",
      configPath: join(wranglerDir, "wrangler.json"),
    };
  }
  if (hasToml) {
    return {
      ok: false,
      kind: "toml_only",
      tomlPath: join(wranglerDir, "wrangler.toml"),
    };
  }
  return { ok: true, kind: "nothing" };
}
