import { readFileSync } from "node:fs";
import type { FatalError } from "./findings.js";
import { fatal } from "./findings.js";
import { parseDataMap } from "./data-map/parse.js";
import type { ParseDataMapResult } from "./data-map/types.js";
import { parseSubprocessors } from "./subprocessors/parse.js";
import type { ParseSubprocessorsResult } from "./subprocessors/types.js";

export function readTextFile(
  filePath: string,
): { ok: true; text: string } | { ok: false; error: FatalError } {
  try {
    const text = readFileSync(filePath, "utf8");
    return { ok: true, text };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: fatal(filePath, `cannot read file: ${detail}`) };
  }
}

export function loadDataMapFile(filePath: string): ParseDataMapResult {
  const read = readTextFile(filePath);
  if (!read.ok) {
    return { fatal: read.error };
  }
  return parseDataMap(read.text, filePath);
}

export function loadSubprocessorsFile(filePath: string): ParseSubprocessorsResult {
  const read = readTextFile(filePath);
  if (!read.ok) {
    return { fatal: read.error };
  }
  return parseSubprocessors(read.text, filePath);
}
