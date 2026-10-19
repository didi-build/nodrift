import { join } from "node:path";
import { expandDataMap } from "../data-map/expand.js";
import { fatal } from "../findings.js";
import { loadDataMapFile, readTextFile } from "../load.js";
import { compareBindingsToMap } from "./compare.js";
import { extractBindings } from "./extract-bindings.js";
import { locateWranglerConfig } from "./locate-config.js";
import { parseWranglerConfig } from "./parse-wrangler.js";
import type { CheckDataStoresVsMapResult } from "./types.js";

export type CheckDataStoresVsMapOptions = {
  mapFilePath: string;
  wranglerDir: string;
};

export function checkDataStoresVsMap(
  options: CheckDataStoresVsMapOptions,
): CheckDataStoresVsMapResult {
  const { mapFilePath, wranglerDir } = options;

  const loaded = loadDataMapFile(mapFilePath);
  if ("fatal" in loaded) {
    return { kind: "fatal", fatal: loaded.fatal };
  }

  const { map, findings: loaderFindings } = loaded;
  if (loaderFindings.length > 0) {
    return { kind: "findings", findings: loaderFindings };
  }

  const located = locateWranglerConfig(wranglerDir);
  if (!located.found) {
    if (located.reason === "toml_only") {
      return {
        kind: "fatal",
        fatal: fatal(
          join(wranglerDir, "wrangler.toml"),
          "`wrangler.toml` is not supported in v1; use `wrangler.jsonc`",
        ),
      };
    }
    return {
      kind: "ok",
      outcome: "nothing_to_check",
      bindingCount: 0,
    };
  }

  const read = readTextFile(located.configPath);
  if (!read.ok) {
    return { kind: "fatal", fatal: read.error };
  }

  const parsed = parseWranglerConfig(read.text, located.configPath);
  if (!parsed.ok) {
    return { kind: "fatal", fatal: parsed.fatal };
  }

  const { bindings, multipleD1Sections } = extractBindings(parsed.root);
  const expanded = expandDataMap(map);

  const comparisonFindings = compareBindingsToMap({
    bindings,
    multipleD1Sections,
    expanded,
    wranglerConfigPath: located.configPath,
  });

  if (comparisonFindings.length > 0) {
    return { kind: "findings", findings: comparisonFindings };
  }

  return {
    kind: "ok",
    outcome: "checked",
    bindingCount: bindings.length,
  };
}
