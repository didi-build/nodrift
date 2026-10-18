import { parseYamlDocument } from "../yaml-parse.js";
import type { ParseDataMapResult } from "./types.js";
import { validateDataMapRoot } from "./validate.js";

export function parseDataMap(text: string, filePath: string): ParseDataMapResult {
  const parsed = parseYamlDocument(text, filePath);
  if (!parsed.ok) {
    return { fatal: parsed.error };
  }

  const validated = validateDataMapRoot(parsed.value, filePath);
  if (!validated.ok) {
    return { fatal: validated.fatal };
  }

  return { map: validated.map, findings: validated.findings };
}
