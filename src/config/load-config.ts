import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fatal, type FatalError } from "../findings.js";
import { DEFAULT_CONFIG, parseConfig, type NodriftConfig } from "./parse-config.js";

export type ResolvedNodriftConfig = NodriftConfig & {
  /** Absolute paths for file and directory targets. */
  mapPath: string;
  subprocessorsPath: string;
  migrationsDir: string;
  wranglerDir: string;
};

export type LoadConfigResult =
  | { ok: true; config: ResolvedNodriftConfig; configFilePath: string | null }
  | { ok: false; fatal: FatalError };

function resolvePaths(repoRoot: string, config: NodriftConfig): ResolvedNodriftConfig {
  return {
    ...config,
    mapPath: join(repoRoot, config.map),
    subprocessorsPath: join(repoRoot, config.subprocessors),
    migrationsDir: join(repoRoot, config.migrations),
    wranglerDir: join(repoRoot, config.wrangler),
  };
}

/**
 * Load config from `nodrift.config.json` or `--config` path (relative to repo root).
 * Missing default config file yields defaults; an explicit `--config` path must exist.
 */
export function loadConfig(
  repoRoot: string,
  configPathOption?: string,
): LoadConfigResult {
  const configFilePath = configPathOption
    ? join(repoRoot, configPathOption)
    : join(repoRoot, "nodrift.config.json");

  if (configPathOption) {
    try {
      const text = readFileSync(configFilePath, "utf8");
      const parsed = parseConfig(text, configFilePath);
      if (!parsed.ok) {
        return parsed;
      }
      return {
        ok: true,
        config: resolvePaths(repoRoot, parsed.config),
        configFilePath,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        fatal: fatal(configFilePath, `cannot read config file: ${detail}`),
      };
    }
  }

  try {
    const text = readFileSync(configFilePath, "utf8");
    const parsed = parseConfig(text, configFilePath);
    if (!parsed.ok) {
      return parsed;
    }
    return {
      ok: true,
      config: resolvePaths(repoRoot, parsed.config),
      configFilePath,
    };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return {
        ok: true,
        config: resolvePaths(repoRoot, { ...DEFAULT_CONFIG }),
        configFilePath: null,
      };
    }
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      fatal: fatal(configFilePath, `cannot read config file: ${detail}`),
    };
  }
}
