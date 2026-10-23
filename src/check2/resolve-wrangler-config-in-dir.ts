import { join } from "node:path";

export type ResolvedWranglerConfigInDir =
  | { kind: "config"; configPath: string; skippedConfigPath?: string }
  | { kind: "nothing" }
  | { kind: "toml_only"; tomlPath: string };

const WRANGLER_JSONC = "wrangler.jsonc";
const WRANGLER_JSON = "wrangler.json";
const WRANGLER_TOML = "wrangler.toml";

/**
 * Picks one Wrangler config file in a directory: `wrangler.json`, then `wrangler.jsonc`
 * (same order as Wrangler). When only `wrangler.toml` exists, returns `toml_only`.
 */
export function resolveWranglerConfigInDir(
  wranglerDir: string,
  names: readonly string[],
): ResolvedWranglerConfigInDir {
  const hasJson = names.includes(WRANGLER_JSON);
  const hasJsonc = names.includes(WRANGLER_JSONC);
  if (hasJson) {
    const configPath = join(wranglerDir, WRANGLER_JSON);
    if (hasJsonc) {
      return {
        kind: "config",
        configPath,
        skippedConfigPath: join(wranglerDir, WRANGLER_JSONC),
      };
    }
    return { kind: "config", configPath };
  }
  if (hasJsonc) {
    return { kind: "config", configPath: join(wranglerDir, WRANGLER_JSONC) };
  }
  if (names.includes(WRANGLER_TOML)) {
    return { kind: "toml_only", tomlPath: join(wranglerDir, WRANGLER_TOML) };
  }
  return { kind: "nothing" };
}
