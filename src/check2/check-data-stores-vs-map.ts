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

export type CheckDataStoresVsMapOptions = {
  mapFilePath: string;
  /**
   * Legacy single-directory resolution (unit tests). When set without `repoRoot`, only this
   * directory is checked using v1 file precedence (TOML-only is a fatal).
   */
  wranglerDir?: string;
  /** Repository root for discovery or explicit config paths (CLI). */
  repoRoot?: string;
  /** Absolute paths to Wrangler configs; skips discovery when set. */
  wranglerConfigPaths?: readonly string[];
  /** Directory under `repoRoot` to search (default `.`). Ignored when `wranglerConfigPaths` is set. */
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

function bindingNameFromFinding(finding: Finding): string {
  const match = /binding `([^`]+)`/.exec(finding.message);
  return match?.[1] ?? "";
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const byFile = compareCodeUnits(a.file, b.file);
    if (byFile !== 0) {
      return byFile;
    }
    const byBinding = compareCodeUnits(
      bindingNameFromFinding(a),
      bindingNameFromFinding(b),
    );
    if (byBinding !== 0) {
      return byBinding;
    }
    return compareCodeUnits(a.message, b.message);
  });
}

function fatalResult(fatals: FatalError[]): CheckDataStoresVsMapResult {
  return { kind: "fatal", fatal: fatals[0], fatals };
}

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
    return fatalResult([
      fatal(
        located.tomlPath,
        "`wrangler.toml` is not supported in v1; use `wrangler.jsonc`",
      ),
    ]);
  }

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
    return {
      kind: "ok",
      outcome: "nothing_to_check",
      bindingCount: 0,
    };
  }

  const single = checkSingleWranglerConfig(
    located.configPath,
    mapBindings,
    wranglerReadFs,
  );
  if (!isSingleConfigSuccess(single)) {
    return single;
  }
  if (single.findings.length > 0) {
    return { kind: "findings", findings: single.findings };
  }
  return {
    kind: "ok",
    outcome: "checked",
    bindingCount: single.bindingCount,
  };
}

function checkDiscoveredWranglerConfigs(
  options: CheckDataStoresVsMapOptions,
  mapBindings: ReadonlySet<string>,
): CheckDataStoresVsMapResult {
  const { repoRoot, wranglerConfigPaths, wranglerSearchDir, wranglerReadFs } = options;
  if (!repoRoot) {
    return fatalResult([
      fatal("", "internal error: discovery Check 2 called without repoRoot"),
    ]);
  }

  let configPaths: string[];
  if (wranglerConfigPaths && wranglerConfigPaths.length > 0) {
    const resolved = resolveExplicitWranglerConfigPaths(wranglerConfigPaths);
    if (!resolved.ok) {
      return fatalResult([resolved.fatal]);
    }
    configPaths = resolved.configPaths;
  } else {
    const searchRoot = wranglerSearchDir ?? repoRoot;
    const discovered = discoverWranglerConfigPaths(searchRoot, true);
    if (!discovered.ok) {
      return fatalResult([discovered.fatal]);
    }
    configPaths = discovered.configPaths;
  }

  if (configPaths.length === 0) {
    if (mapBindings.size > 0) {
      const names = formatMapBindingNames(mapBindings);
      const searchLabel = wranglerSearchDir ?? repoRoot;
      return fatalResult([
        fatal(
          searchLabel,
          `the map references bindings (${names}) but no Wrangler config was found under ${searchLabel}; check the \`wrangler\` path or set \`wranglerConfigs\``,
        ),
      ]);
    }
    return {
      kind: "ok",
      outcome: "nothing_to_check",
      bindingCount: 0,
    };
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
    return fatalResult(fatals);
  }

  if (allFindings.length > 0) {
    return { kind: "findings", findings: sortFindings(allFindings) };
  }

  return {
    kind: "ok",
    outcome: "checked",
    bindingCount,
  };
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
