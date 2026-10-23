import { expandDataMap } from "../data-map/expand.js";
import { fatal, type FatalError, type Finding } from "../findings.js";
import { loadDataMapFile } from "../load.js";
import {
  collectCoveredBindings,
  compareBindingsToMap,
  formatMapBindingNames,
} from "./compare.js";
import { discoverWranglerConfigPaths } from "./discover-wrangler-configs.js";
import { extractBindings } from "./extract-bindings.js";
import {
  locateWranglerConfig,
  type WranglerConfigFs,
} from "./locate-wrangler-config.js";
import { parseWranglerConfigFile, type WranglerReadFs } from "./parse-wrangler.js";
import { resolveExplicitWranglerConfigPaths } from "./resolve-explicit-wrangler-configs.js";
import type { CheckDataStoresVsMapResult } from "./types.js";
import { formatUnreadableDirSkippedWarning } from "./discovery-warnings.js";
import { formatWranglerJsoncSkippedWarning } from "./wrangler-json-skip-warning.js";
import { formatWranglerTomlSkippedWarning } from "./wrangler-toml-warning.js";

export type CheckDataStoresVsMapOptions = {
  mapFilePath: string;
  /**
   * Legacy single-directory resolution (unit tests). When set without `repoRoot`, only this
   * directory is checked using v1 file precedence (TOML-only is a fatal).
   */
  wranglerDir?: string;
  /** Repository root for discovery or explicit config paths (CLI). */
  repoRoot?: string;
  /** Absolute paths to Wrangler configs; skips discovery when set (including `[]`). */
  wranglerConfigPaths?: readonly string[];
  /** When true, `wranglerConfigPaths` was set explicitly in config (even if empty). */
  wranglerConfigsExplicit?: boolean;
  /** Directory under `repoRoot` to search (default `.`). Ignored when explicit `wranglerConfigs`. */
  wranglerSearchDir?: string;
  /** @internal Test hook for Wrangler directory reads. */
  wranglerConfigFs?: WranglerConfigFs;
  /** @internal Test hook for Wrangler config reads. */
  wranglerReadFs?: WranglerReadFs;
};

function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const byFile = compareCodeUnits(a.file, b.file);
    if (byFile !== 0) {
      return byFile;
    }
    const byCode = compareCodeUnits(a.code, b.code);
    if (byCode !== 0) {
      return byCode;
    }
    const byPath = compareCodeUnits(a.path, b.path);
    if (byPath !== 0) {
      return byPath;
    }
    return compareCodeUnits(a.message, b.message);
  });
}

function tomlSkipWarnings(paths: readonly string[]): string[] {
  return paths.map(formatWranglerTomlSkippedWarning);
}

function jsoncSkipWarnings(paths: readonly string[]): string[] {
  return paths.map(formatWranglerJsoncSkippedWarning);
}

function unreadableDirWarnings(paths: readonly string[]): string[] {
  return paths.map(formatUnreadableDirSkippedWarning);
}

function discoveryWarnings(
  skippedUnreadableDirs: readonly string[],
  skippedTomlPaths: readonly string[],
  skippedJsoncPaths: readonly string[],
): string[] {
  const warnings = [
    ...unreadableDirWarnings(skippedUnreadableDirs),
    ...jsoncSkipWarnings(skippedJsoncPaths),
    ...tomlSkipWarnings(skippedTomlPaths),
  ];
  warnings.sort(compareCodeUnits);
  return warnings;
}

function attachWarnings<T extends CheckDataStoresVsMapResult>(
  result: T,
  warnings: readonly string[],
): T {
  if (warnings.length === 0) {
    return result;
  }
  return { ...result, warnings };
}

function fatalResult(
  fatals: FatalError[],
  warnings: readonly string[] = [],
): CheckDataStoresVsMapResult {
  return attachWarnings({ kind: "fatal", fatal: fatals[0], fatals }, warnings);
}

const TOML_ONLY_FATAL_MESSAGE =
  "`wrangler.toml` is not supported in v1; use `wrangler.jsonc`";

type SingleConfigSuccess = {
  ok: true;
  bindingCount: number;
  findings: Finding[];
};

function isSingleConfigSuccess(
  result: CheckDataStoresVsMapResult | SingleConfigSuccess,
): result is SingleConfigSuccess {
  return "ok" in result && result.ok === true;
}

function checkSingleWranglerConfig(
  configPath: string,
  mapBindings: ReadonlySet<string>,
  wranglerReadFs?: WranglerReadFs,
): CheckDataStoresVsMapResult | SingleConfigSuccess {
  const parsed = parseWranglerConfigFile(configPath, wranglerReadFs);
  if (!parsed.ok) {
    return { kind: "fatal", fatal: parsed.fatal, fatals: [parsed.fatal] };
  }

  const { bindings, multipleD1InSection, durableObjectBindings } = extractBindings(
    parsed.config,
  );
  const comparisonFindings = compareBindingsToMap(
    bindings,
    mapBindings,
    configPath,
    multipleD1InSection,
    durableObjectBindings,
  );

  return {
    ok: true,
    bindingCount: bindings.length,
    findings: comparisonFindings,
  };
}

function checkLegacyWranglerDir(
  options: CheckDataStoresVsMapOptions,
  mapBindings: ReadonlySet<string>,
): CheckDataStoresVsMapResult {
  const { wranglerDir, wranglerConfigFs, wranglerReadFs } = options;
  if (!wranglerDir) {
    return fatalResult([
      fatal("", "internal error: legacy Check 2 called without wranglerDir"),
    ]);
  }

  const located = locateWranglerConfig(wranglerDir, wranglerConfigFs);
  if (!located.ok) {
    if ("fatal" in located) {
      return fatalResult([located.fatal]);
    }
    return fatalResult([fatal(located.tomlPath, TOML_ONLY_FATAL_MESSAGE)]);
  }

  const legacyWarnings =
    located.kind === "config" && located.skippedConfigPath
      ? [formatWranglerJsoncSkippedWarning(located.skippedConfigPath)]
      : [];

  if (located.kind === "nothing") {
    if (mapBindings.size > 0) {
      const names = formatMapBindingNames(mapBindings);
      return fatalResult([
        fatal(
          wranglerDir,
          `the map references bindings (${names}) but no Wrangler config was found in ${wranglerDir}; check the \`wrangler\` path`,
        ),
      ]);
    }
    return attachWarnings(
      {
        kind: "ok",
        outcome: "nothing_to_check",
        bindingCount: 0,
      },
      legacyWarnings,
    );
  }

  const single = checkSingleWranglerConfig(
    located.configPath,
    mapBindings,
    wranglerReadFs,
  );
  if (!isSingleConfigSuccess(single)) {
    return attachWarnings(single, legacyWarnings);
  }
  if (single.findings.length > 0) {
    return attachWarnings(
      { kind: "findings", findings: single.findings },
      legacyWarnings,
    );
  }
  return attachWarnings(
    {
      kind: "ok",
      outcome: "checked",
      bindingCount: single.bindingCount,
    },
    legacyWarnings,
  );
}

function finishDiscoveredRun(
  configPaths: readonly string[],
  skippedUnreadableDirs: readonly string[],
  skippedTomlPaths: readonly string[],
  skippedJsoncPaths: readonly string[],
  mapBindings: ReadonlySet<string>,
  wranglerReadFs?: WranglerReadFs,
  missingConfigFatal?: FatalError,
): CheckDataStoresVsMapResult {
  const warnings = discoveryWarnings(
    skippedUnreadableDirs,
    skippedTomlPaths,
    skippedJsoncPaths,
  );

  if (configPaths.length === 0) {
    if (skippedTomlPaths.length > 0) {
      return fatalResult(
        [fatal(skippedTomlPaths[0], TOML_ONLY_FATAL_MESSAGE)],
        warnings,
      );
    }
    if (mapBindings.size > 0 && missingConfigFatal) {
      return fatalResult([missingConfigFatal], warnings);
    }
    return attachWarnings(
      {
        kind: "ok",
        outcome: "nothing_to_check",
        bindingCount: 0,
      },
      warnings,
    );
  }
  const allFindings: Finding[] = [];
  const fatals: FatalError[] = [];
  let bindingCount = 0;

  for (const configPath of configPaths) {
    const single = checkSingleWranglerConfig(configPath, mapBindings, wranglerReadFs);
    if ("kind" in single && single.kind === "fatal") {
      fatals.push(single.fatal);
      continue;
    }
    if (!isSingleConfigSuccess(single)) {
      continue;
    }
    bindingCount += single.bindingCount;
    allFindings.push(...single.findings);
  }

  if (fatals.length > 0) {
    fatals.sort((a, b) => compareCodeUnits(a.file, b.file));
    return fatalResult(fatals, warnings);
  }

  if (allFindings.length > 0) {
    return attachWarnings(
      { kind: "findings", findings: sortFindings(allFindings) },
      warnings,
    );
  }

  return attachWarnings(
    {
      kind: "ok",
      outcome: "checked",
      bindingCount,
    },
    warnings,
  );
}

function checkDiscoveredWranglerConfigs(
  options: CheckDataStoresVsMapOptions,
  mapBindings: ReadonlySet<string>,
): CheckDataStoresVsMapResult {
  const {
    repoRoot,
    wranglerConfigPaths,
    wranglerConfigsExplicit,
    wranglerSearchDir,
    wranglerReadFs,
  } = options;
  if (!repoRoot) {
    return fatalResult([
      fatal("", "internal error: discovery Check 2 called without repoRoot"),
    ]);
  }

  const searchLabel = wranglerSearchDir ?? repoRoot;
  const missingConfigFatal =
    mapBindings.size > 0
      ? fatal(
          searchLabel,
          `the map references bindings (${formatMapBindingNames(mapBindings)}) but no Wrangler config was found under ${searchLabel}; check the \`wrangler\` path or set \`wranglerConfigs\``,
        )
      : undefined;

  if (wranglerConfigsExplicit) {
    const paths = wranglerConfigPaths ?? [];
    if (paths.length === 0) {
      return finishDiscoveredRun(
        [],
        [],
        [],
        [],
        mapBindings,
        wranglerReadFs,
        missingConfigFatal,
      );
    }
    const resolved = resolveExplicitWranglerConfigPaths(paths);
    if (!resolved.ok) {
      return fatalResult([resolved.fatal]);
    }
    return finishDiscoveredRun(
      resolved.configPaths,
      [],
      [],
      [],
      mapBindings,
      wranglerReadFs,
      missingConfigFatal,
    );
  }

  const searchRoot = wranglerSearchDir ?? repoRoot;
  const discovered = discoverWranglerConfigPaths(searchRoot);
  if (!discovered.ok) {
    return fatalResult([discovered.fatal]);
  }

  return finishDiscoveredRun(
    discovered.configPaths,
    discovered.skippedUnreadableDirs,
    discovered.skippedTomlPaths,
    discovered.skippedJsoncPaths,
    mapBindings,
    wranglerReadFs,
    missingConfigFatal,
  );
}

export function checkDataStoresVsMap(
  options: CheckDataStoresVsMapOptions,
): CheckDataStoresVsMapResult {
  const loaded = loadDataMapFile(options.mapFilePath);
  if ("fatal" in loaded) {
    return fatalResult([loaded.fatal]);
  }

  const { map, findings: loaderFindings } = loaded;
  if (loaderFindings.length > 0) {
    return { kind: "findings", findings: loaderFindings };
  }

  const mapBindings = collectCoveredBindings(expandDataMap(map));

  const useLegacy = options.wranglerDir !== undefined && options.repoRoot === undefined;

  if (useLegacy) {
    return checkLegacyWranglerDir(options, mapBindings);
  }

  return checkDiscoveredWranglerConfigs(options, mapBindings);
}
