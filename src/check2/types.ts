import type { Finding, FatalError } from "../findings.js";

export type BindingKind = "d1" | "r2" | "kv" | "queue" | "images";

export type BindingLocation = {
  /** Human label, e.g. `top level`, `previews`, `env.staging`. */
  section: string;
  /** JSON path inside the Wrangler config, e.g. `d1_databases[0].binding`. */
  path: string;
};

export type CollectedBinding = {
  name: string;
  kind: BindingKind;
  locations: BindingLocation[];
};

export type CheckDataStoresVsMapOk = {
  kind: "ok";
  outcome: "checked" | "nothing_to_check";
  bindingCount: number;
};

export type CheckDataStoresVsMapFindings = {
  kind: "findings";
  findings: Finding[];
};

export type CheckDataStoresVsMapFatal = {
  kind: "fatal";
  fatal: FatalError;
};

export type CheckDataStoresVsMapResult =
  CheckDataStoresVsMapOk | CheckDataStoresVsMapFindings | CheckDataStoresVsMapFatal;

export type { FatalError };
