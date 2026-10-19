import type { Finding } from "../findings.js";
import { finding } from "../findings.js";
import {
  isBoolean,
  isNonEmptyString,
  isString,
  isStringList,
  typoHint,
} from "./fields.js";

export function pushUnknownKeys(
  findings: Finding[],
  file: string,
  yamlPath: string,
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      const hint = typoHint(key, allowed);
      const hintText = hint ? ` (did you mean \`${hint}\`?)` : "";
      findings.push(
        finding(
          file,
          yamlPath ? `${yamlPath}.${key}` : key,
          "unknown_key",
          `unknown key \`${key}\`${hintText}`,
          `remove \`${key}\` or rename it to a supported field`,
        ),
      );
    }
  }
}

export function validateColumnFields(
  findings: Finding[],
  file: string,
  yamlPath: string,
  raw: Record<string, unknown>,
): void {
  if ("whose" in raw && raw.whose !== undefined && !isString(raw.whose)) {
    findings.push(
      finding(
        file,
        `${yamlPath}.whose`,
        "invalid_type",
        "`whose` must be a string",
        "set `whose` to a classification string",
      ),
    );
  }
  if ("data" in raw && raw.data !== undefined && !isString(raw.data)) {
    findings.push(
      finding(
        file,
        `${yamlPath}.data`,
        "invalid_type",
        "`data` must be a string",
        "set `data` to a short description of what is stored",
      ),
    );
  }
  if ("purpose" in raw && raw.purpose !== undefined && !isString(raw.purpose)) {
    findings.push(
      finding(
        file,
        `${yamlPath}.purpose`,
        "invalid_type",
        "`purpose` must be a string",
        "set `purpose` to why this data is collected or kept",
      ),
    );
  }
  if ("storage" in raw && raw.storage !== undefined && !isString(raw.storage)) {
    findings.push(
      finding(
        file,
        `${yamlPath}.storage`,
        "invalid_type",
        "`storage` must be a string",
        "set `storage` to where the data lives (for example `D1`)",
      ),
    );
  }
  if (
    "processors" in raw &&
    raw.processors !== undefined &&
    !isStringList(raw.processors)
  ) {
    findings.push(
      finding(
        file,
        `${yamlPath}.processors`,
        "invalid_type",
        "`processors` must be a list of strings",
        "set `processors` to a YAML list of vendor names (use `[]` for none)",
      ),
    );
  }
  if ("retention" in raw && raw.retention !== undefined && !isString(raw.retention)) {
    findings.push(
      finding(
        file,
        `${yamlPath}.retention`,
        "invalid_type",
        "`retention` must be a string",
        "set `retention` to how long the data is kept",
      ),
    );
  }
  if (
    "who_can_see" in raw &&
    raw.who_can_see !== undefined &&
    !isString(raw.who_can_see)
  ) {
    findings.push(
      finding(
        file,
        `${yamlPath}.who_can_see`,
        "invalid_type",
        "`who_can_see` must be a string",
        "set `who_can_see` to who can access this data",
      ),
    );
  }
  if ("source" in raw && raw.source !== undefined && !isString(raw.source)) {
    findings.push(
      finding(
        file,
        `${yamlPath}.source`,
        "invalid_type",
        "`source` must be a string",
        "set `source` to a code path or reference",
      ),
    );
  }
  if ("verified" in raw && raw.verified !== undefined && !isBoolean(raw.verified)) {
    findings.push(
      finding(
        file,
        `${yamlPath}.verified`,
        "invalid_type",
        "`verified` must be a boolean",
        "set `verified` to `true` or `false`",
      ),
    );
  }
  if ("notes" in raw && raw.notes !== undefined && !isString(raw.notes)) {
    findings.push(
      finding(
        file,
        `${yamlPath}.notes`,
        "invalid_type",
        "`notes` must be a string",
        "set `notes` to free-form text or remove the field",
      ),
    );
  }
}

export function validateBinding(
  findings: Finding[],
  file: string,
  yamlPath: string,
  binding: unknown,
): void {
  if (binding === undefined) {
    return;
  }
  if (isNonEmptyString(binding)) {
    return;
  }
  if (isStringList(binding) && binding.length > 0 && binding.every(isNonEmptyString)) {
    return;
  }
  findings.push(
    finding(
      file,
      `${yamlPath}.binding`,
      "invalid_binding",
      "`binding` must be a non-empty string or a list of non-empty strings",
      "set `binding` to a Wrangler binding name or a list of binding names",
    ),
  );
}

export function mergeColumnLayer(
  defaults: Record<string, unknown> | undefined,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  if (defaults) {
    for (const key of [
      "whose",
      "data",
      "purpose",
      "storage",
      "processors",
      "retention",
      "who_can_see",
      "source",
      "verified",
      "notes",
    ]) {
      if (key in defaults) {
        merged[key] = defaults[key];
      }
    }
  }
  for (const key of Object.keys(override)) {
    if (override[key] !== undefined) {
      merged[key] = override[key];
    }
  }
  return merged;
}
