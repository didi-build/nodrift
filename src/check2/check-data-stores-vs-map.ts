import { expandDataMap } from "../data-map/expand.js";
import { fatal } from "../findings.js";
import { loadDataMapFile } from "../load.js";
import {
  collectCoveredBindings,
  compareBindingsToMap,
  formatMapBindingNames,
} from "./compare.js";
import { extractBindings } from "./extract-bindings.js";
import {
  locateWranglerConfig,
  type WranglerConfigFs,
} from "./locate-wrangler-config.js";
import { parseWranglerConfigFile, type WranglerReadFs } from "./parse-wrangler.js";
import type { CheckDataStoresVsMapResult } from "./types.js";

export type CheckDataStoresVsMapOptions = {
  mapFilePath: string;
  wranglerDir: string;
  /** @internal Test hook for Wrangler directory reads. */
  wranglerConfigFs?: WranglerConfigFs;
  /** @internal Test hook for Wrangler config reads. */
  wranglerReadFs?: WranglerReadFs;
};

export function checkDataStoresVsMap(
  options: CheckDataStoresVsMapOptions,
): CheckDataStoresVsMapResult {
  const { mapFilePath, wranglerDir, wranglerConfigFs, wranglerReadFs } = options;

  const loaded = loadDataMapFile(mapFilePath);
  if ("fatal" in loaded) {
    return { kind: "fatal", fatal: loaded.fatal };
  }

  const { map, findings: loaderFindings } = loaded;
  if (loaderFindings.length > 0) {
    return { kind: "findings", findings: loaderFindings };
  }

  const mapBindings = collectCoveredBindings(expandDataMap(map));

  const located = locateWranglerConfig(wranglerDir, wranglerConfigFs);
  if (!located.ok) {
    if ("fatal" in located) {
      return { kind: "fatal", fatal: located.fatal };
    }
    return {
      kind: "fatal",
      fatal: fatal(
        located.tomlPath,
        "`wrangler.toml` is not supported in v1; use `wrangler.jsonc`",
      ),
    };
  }

  if (located.kind === "nothing") {
    if (mapBindings.size > 0) {
      const names = formatMapBindingNames(mapBindings);
      return {
        kind: "fatal",
        fatal: fatal(
          wranglerDir,
          `the map references bindings (${names}) but no Wrangler config was found in ${wranglerDir}; check the \`wrangler\` path`,
        ),
      };
    }
    return {
      kind: "ok",
      outcome: "nothing_to_check",
      bindingCount: 0,
    };
  }

  const parsed = parseWranglerConfigFile(located.configPath, wranglerReadFs);
  if (!parsed.ok) {
    return { kind: "fatal", fatal: parsed.fatal };
  }

  const { bindings, multipleD1InSection } = extractBindings(parsed.config);
  const covered = collectCoveredBindings(expandDataMap(map));
  const comparisonFindings = compareBindingsToMap(
    bindings,
    covered,
    located.configPath,
    multipleD1InSection,
  );

  if (comparisonFindings.length > 0) {
    return { kind: "findings", findings: comparisonFindings };
  }

  return {
    kind: "ok",
    outcome: "checked",
    bindingCount: bindings.length,
  };
}
