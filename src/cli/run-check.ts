import { statSync } from "node:fs";
import { fatal } from "../findings.js";
import { checkMapVsMigrations } from "../check1/check-map-vs-migrations.js";
import type { CheckMapVsMigrationsResult } from "../check1/types.js";
import { checkDataStoresVsMap } from "../check2/check-data-stores-vs-map.js";
import type { CheckDataStoresVsMapResult } from "../check2/types.js";
import type { ResolvedNodriftConfig } from "../config/load-config.js";
import type { FatalError, Finding } from "../findings.js";
import { loadDataMapFile, loadSubprocessorsFile } from "../load.js";
import {
  formatCheckStepLine,
  formatFatal,
  formatFinding,
  formatSummary,
  type CheckStepStatus,
} from "./format-output.js";

export type RunCheckResult = {
  exitCode: number;
  lines: string[];
};

function isMissingPathError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
  return false;
}

function formatErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type SubprocessorsPathState =
  { kind: "missing" } | { kind: "file" } | { kind: "fatal"; fatal: FatalError };

function subprocessorsPathState(path: string): SubprocessorsPathState {
  try {
    const st = statSync(path);
    if (st.isFile()) {
      return { kind: "file" };
    }
    return {
      kind: "fatal",
      fatal: fatal(path, "subprocessors path exists but is not a file"),
    };
  } catch (err) {
    if (isMissingPathError(err)) {
      return { kind: "missing" };
    }
    return {
      kind: "fatal",
      fatal: fatal(path, `cannot read subprocessors path: ${formatErr(err)}`),
    };
  }
}

function check1Status(result: CheckMapVsMigrationsResult): CheckStepStatus {
  if (result.kind === "fatal") {
    return { kind: "cannot_run" };
  }
  if (result.kind === "findings") {
    return { kind: "problems", count: result.findings.length };
  }
  if (result.outcome === "nothing_to_check") {
    return { kind: "nothing" };
  }
  return {
    kind: "ok",
    detail: `${result.tableCount} tables, ${result.columnCount} columns`,
  };
}

function check2Status(result: CheckDataStoresVsMapResult): CheckStepStatus {
  if (result.kind === "fatal") {
    return { kind: "cannot_run" };
  }
  if (result.kind === "findings") {
    return { kind: "problems", count: result.findings.length };
  }
  if (result.outcome === "nothing_to_check") {
    return { kind: "nothing" };
  }
  return {
    kind: "ok",
    detail: `${result.bindingCount} bindings`,
  };
}

function subprocessorsStatus(
  hadFile: boolean,
  fatal: FatalError | undefined,
  count: number,
): CheckStepStatus | null {
  if (!hadFile) {
    return null;
  }
  if (fatal) {
    return { kind: "cannot_run" };
  }
  if (count > 0) {
    return { kind: "problems", count };
  }
  return { kind: "ok", detail: "valid" };
}

export function runCheck(config: ResolvedNodriftConfig): RunCheckResult {
  const lines: string[] = [];
  const findings: Finding[] = [];
  const fatals: FatalError[] = [];

  const mapLoaded = loadDataMapFile(config.mapPath);
  if ("fatal" in mapLoaded) {
    lines.push(formatFatal(mapLoaded.fatal));
    lines.push(formatSummary(0, 1));
    return { exitCode: 2, lines };
  }

  if (mapLoaded.findings.length > 0) {
    for (const finding of mapLoaded.findings) {
      lines.push(formatFinding(finding));
    }
    lines.push(formatSummary(mapLoaded.findings.length, 0));
    return { exitCode: 1, lines };
  }

  let subprocessorsHadFile = false;
  let subprocessorsFatal: FatalError | undefined;
  let subprocessorsFindingCount = 0;

  const subprocessorsState = subprocessorsPathState(config.subprocessorsPath);
  if (subprocessorsState.kind === "fatal") {
    subprocessorsHadFile = true;
    subprocessorsFatal = subprocessorsState.fatal;
    fatals.push(subprocessorsState.fatal);
  } else if (subprocessorsState.kind === "file") {
    subprocessorsHadFile = true;
    const subprocessorsLoaded = loadSubprocessorsFile(config.subprocessorsPath);
    if ("fatal" in subprocessorsLoaded) {
      subprocessorsFatal = subprocessorsLoaded.fatal;
      fatals.push(subprocessorsLoaded.fatal);
    } else if (subprocessorsLoaded.findings.length > 0) {
      subprocessorsFindingCount = subprocessorsLoaded.findings.length;
      findings.push(...subprocessorsLoaded.findings);
    }
  }

  const check1 = checkMapVsMigrations({
    mapFilePath: config.mapPath,
    migrationsDir: config.migrationsDir,
    ignoreTables: config.ignoreTables,
  });
  if (check1.kind === "fatal") {
    fatals.push(check1.fatal);
  } else if (check1.kind === "findings") {
    findings.push(...check1.findings);
  }

  const check2 = checkDataStoresVsMap({
    mapFilePath: config.mapPath,
    wranglerDir: config.wranglerDir,
  });
  if (check2.kind === "fatal") {
    fatals.push(check2.fatal);
  } else if (check2.kind === "findings") {
    findings.push(...check2.findings);
  }

  const subprocessorsLine = subprocessorsStatus(
    subprocessorsHadFile,
    subprocessorsFatal,
    subprocessorsFindingCount,
  );
  if (subprocessorsLine) {
    lines.push(formatCheckStepLine("subprocessors", subprocessorsLine));
  }
  lines.push(formatCheckStepLine("check 1 (map vs migrations)", check1Status(check1)));
  lines.push(formatCheckStepLine("check 2 (data stores vs map)", check2Status(check2)));

  for (const fatal of fatals) {
    lines.push(formatFatal(fatal));
  }
  for (const finding of findings) {
    lines.push(formatFinding(finding));
  }

  const exitCode = fatals.length > 0 ? 2 : findings.length > 0 ? 1 : 0;
  lines.push(formatSummary(findings.length, fatals.length));
  return { exitCode, lines };
}
