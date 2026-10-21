import { statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { FatalError } from "../findings.js";
import { fatal } from "../findings.js";

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

export type PathStat =
  | { kind: "missing" }
  | { kind: "file" }
  | { kind: "directory" }
  | { kind: "error"; fatal: FatalError };

export function statPath(path: string): PathStat {
  try {
    const st = statSync(path);
    if (st.isFile()) {
      return { kind: "file" };
    }
    if (st.isDirectory()) {
      return { kind: "directory" };
    }
    return {
      kind: "error",
      fatal: fatal(path, `path exists but is not a file or directory`),
    };
  } catch (err) {
    if (isMissingPathError(err)) {
      return { kind: "missing" };
    }
    return {
      kind: "error",
      fatal: fatal(path, `cannot read path: ${formatErr(err)}`),
    };
  }
}

export function assertAncestorDirectories(
  repoRoot: string,
  absoluteFilePath: string,
): FatalError | null {
  const relDir = relative(repoRoot, dirname(absoluteFilePath));
  if (relDir === "" || relDir === ".") {
    return null;
  }

  const parts = relDir.split(/[/\\]/).filter((part) => part.length > 0);
  let current = repoRoot;
  for (const part of parts) {
    current = join(current, part);
    const stat = statPath(current);
    if (stat.kind === "missing") {
      continue;
    }
    if (stat.kind === "error") {
      return stat.fatal;
    }
    if (stat.kind === "file") {
      return fatal(current, `path is not a directory`);
    }
  }
  return null;
}
