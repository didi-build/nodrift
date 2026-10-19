import type { Finding, FatalError } from "../findings.js";

export type CheckOutcome = "checked" | "nothing_to_check";

export type CheckDataStoresVsMapOk = {
  kind: "ok";
  outcome: CheckOutcome;
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

export type BindingKind = "d1" | "r2" | "kv" | "queue" | "images";

export type BindingOccurrence = {
  name: string;
  kind: BindingKind;
  section: string;
  jsonPath: string;
};

export type AggregatedBinding = {
  name: string;
  kind: BindingKind;
  sections: readonly string[];
  jsonPath: string;
};
