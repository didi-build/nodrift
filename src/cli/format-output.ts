import type { FatalError, Finding } from "../findings.js";

export function formatFinding(finding: Finding): string {
  const lines = [
    `${finding.file}: ${finding.path}: [${finding.code}] ${finding.message}`,
  ];
  const fixLines = finding.fix.split("\n");
  for (const line of fixLines) {
    lines.push(`  fix: ${line}`);
  }
  return lines.join("\n");
}

export function formatFatal(fatal: FatalError): string {
  return `${fatal.file}: ${fatal.message}`;
}

export type CheckStepStatus =
  | { kind: "ok"; detail: string }
  | { kind: "nothing" }
  | { kind: "problems"; count: number; detail?: string }
  | { kind: "cannot_run" };

export function formatCheckStepLine(label: string, status: CheckStepStatus): string {
  switch (status.kind) {
    case "ok":
      return `${label}: ok (${status.detail})`;
    case "nothing":
      return `${label}: nothing to check`;
    case "problems":
      return `${label}: ${status.count} problem${status.count === 1 ? "" : "s"}`;
    case "cannot_run":
      return `${label}: cannot run`;
  }
}

export function formatSummary(problemCount: number, fatalCount: number): string {
  if (fatalCount > 0) {
    return `nodrift: cannot run (${fatalCount} fatal${fatalCount === 1 ? "" : "s"})`;
  }
  if (problemCount > 0) {
    return `nodrift: ${problemCount} problem${problemCount === 1 ? "" : "s"}`;
  }
  return "nodrift: ok";
}
