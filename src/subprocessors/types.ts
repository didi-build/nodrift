import type { Finding } from "../findings.js";

export type Subprocessor = {
  name: string;
  purpose: string;
  data: string;
  location?: string;
  verified?: boolean;
  notes?: string;
};

export type SubprocessorsFile = {
  schema_version: number;
  subprocessors: Subprocessor[];
};

export type ParseSubprocessorsSuccess = {
  subprocessors: SubprocessorsFile;
  findings: Finding[];
};

export type ParseSubprocessorsFatal = {
  fatal: import("../findings.js").FatalError;
};

export type ParseSubprocessorsResult =
  ParseSubprocessorsSuccess | ParseSubprocessorsFatal;
