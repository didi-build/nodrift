import { join } from "node:path";

export type ResolvedWranglerConfigInDir =
  | { kind: "config"; configPath: string }
  | { kind: "nothing" }
  | { kind: "toml_only"; tomlPath: string };

const WRANGLER_JSONC = "wrangler.jsonc";
const WRANGLER_JSON = "wrangler.json";
const WRANGLER_TOML = "wrangler.toml";

/**
 * Picks one Wrangler config file in a directory: `wrangler.jsonc`, then `wrangler.json`, then `wrangler.toml`.
 * When `allowToml` is false and only TOML exists, returns `toml_only`.
 */
export function resolveWranglerConfigInDir(
  wranglerDir: string,
  names: readonly string[],
  allowToml: boolean,
): ResolvedWranglerConfigInDir {
  const hasJsonc = names.includes(WRANGLER_JSONC);
  const hasJson = names.includes(WRANGLER_JSON);
  const hasToml = names.includes(WRANGLER_TOML);

  if (hasJsonc) {
    return { kind: "config", configPath: join(wranglerDir, WRANGLER_JSONC) };
  }
  if (hasJson) {
    return { kind: "config", configPath: join(wranglerDir, WRANGLER_JSON) };
  }
  if (hasToml) {
    if (allowToml) {
      return { kind: "config", configPath: join(wranglerDir, WRANGLER_TOML) };
    }
    return { kind: "toml_only", tomlPath: join(wranglerDir, WRANGLER_TOML) };
  }
  return { kind: "nothing" };
}
