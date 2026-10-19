import { existsSync } from "node:fs";
import { join } from "node:path";

export type WranglerConfigFile =
  | { found: true; configPath: string; fileName: "wrangler.jsonc" | "wrangler.json" }
  | { found: false; reason: "none" | "toml_only" };

export function locateWranglerConfig(wranglerDir: string): WranglerConfigFile {
  const jsonc = join(wranglerDir, "wrangler.jsonc");
  const json = join(wranglerDir, "wrangler.json");
  const toml = join(wranglerDir, "wrangler.toml");

  const hasJsonc = existsSync(jsonc);
  const hasJson = existsSync(json);
  const hasToml = existsSync(toml);

  if (hasJsonc) {
    return { found: true, configPath: jsonc, fileName: "wrangler.jsonc" };
  }
  if (hasJson) {
    return { found: true, configPath: json, fileName: "wrangler.json" };
  }
  if (hasToml) {
    return { found: false, reason: "toml_only" };
  }
  return { found: false, reason: "none" };
}
