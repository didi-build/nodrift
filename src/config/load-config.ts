import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";
import { fatal, type FatalError } from "../findings.js";
import { DEFAULT_CONFIG, parseConfig, type NodriftConfig } from "./parse-config.js";

export type ResolvedNodriftConfig = NodriftConfig & {
  /** Absolute paths for file and directory targets. */
  mapPath: string;
  subprocessorsPath: string;
  migrationsDir: string;
  wranglerDir: string;
  wranglerConfigPaths: string[];
};

export type LoadConfigResult =
  | { ok: true; config: ResolvedNodriftConfig; configFilePath: string | null }
  | { ok: false; fatal: FatalError };

function resolvePath(repoRoot: string, configPath: string): string {
  return isAbsolute(configPath) ? configPath : resolve(repoRoot, configPath);
}

function canonicalWranglerConfigPath(configPath: string): string {
  try {
    return realpathSync(configPath);
  } catch {
    return normalize(configPath);
  }
}

/** Keeps the first path when several config entries resolve to the same file. */
function dedupeWranglerConfigPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const configPath of paths) {
    const key = canonicalWranglerConfigPath(configPath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(configPath);
  }
  return deduped;
}

function resolvePaths(repoRoot: string, config: NodriftConfig): ResolvedNodriftConfig {
  const wranglerConfigPaths = dedupeWranglerConfigPaths(
    config.wranglerConfigs.map((path) => resolvePath(repoRoot, path)),
  );
  return {
    ...config,
    mapPath: resolvePath(repoRoot, config.map),
    subprocessorsPath: resolvePath(repoRoot, config.subprocessors),
    migrationsDir: resolvePath(repoRoot, config.migrations),
    wranglerDir: resolvePath(repoRoot, config.wrangler),
    wranglerConfigPaths,
  };
}

function resolveConfigFilePath(repoRoot: string, configPathOption: string): string {
  return resolvePath(repoRoot, configPathOption);
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
    ? resolveConfigFilePath(repoRoot, configPathOption)
    : resolve(repoRoot, "nodrift.config.json");

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
