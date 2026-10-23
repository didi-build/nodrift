import { join } from "node:path";

export type ResolvedWranglerConfigInDir =
  | { kind: "config"; configPath: string }
  | { kind: "nothing" }
  | { kind: "toml_only"; tomlPath: string };

const WRANGLER_JSONC = "wrangler.jsonc";
const WRANGLER_JSON = "wrangler.json";
const WRANGLER_TOML = "wrangler.toml";

/**
 * Picks one Wrangler config file in a directory: `wrangler.jsonc`, then `wrangler.json`.
 * When only `wrangler.toml` exists, returns `toml_only`.
 */
export function resolveWranglerConfigInDir(
  wranglerDir: string,
  names: readonly string[],
): ResolvedWranglerConfigInDir {
  if (names.includes(WRANGLER_JSONC)) {
    return { kind: "config", configPath: join(wranglerDir, WRANGLER_JSONC) };
  }
  if (names.includes(WRANGLER_JSON)) {
    return { kind: "config", configPath: join(wranglerDir, WRANGLER_JSON) };
  }
  if (names.includes(WRANGLER_TOML)) {
    return { kind: "toml_only", tomlPath: join(wranglerDir, WRANGLER_TOML) };
  }
  return { kind: "nothing" };
}
