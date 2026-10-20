import { typoHint } from "../data-map/fields.js";
import { fatal, type FatalError } from "../findings.js";

export const CONFIG_KEYS = new Set([
  "map",
  "subprocessors",
  "migrations",
  "wrangler",
  "ignoreTables",
]);

export const DEFAULT_CONFIG = {
  map: "docs/privacy/data-map.yml",
  subprocessors: "docs/privacy/subprocessors.yml",
  migrations: "migrations",
  wrangler: ".",
  ignoreTables: [] as string[],
};

export type NodriftConfig = {
  map: string;
  subprocessors: string;
  migrations: string;
  wrangler: string;
  ignoreTables: string[];
};

export type ParseConfigResult =
  { ok: true; config: NodriftConfig } | { ok: false; fatal: FatalError };

function configFatal(filePath: string, key: string, message: string): FatalError {
  const atKey = key ? ` at \`${key}\`` : "";
  return fatal(filePath, `${message}${atKey}`);
}

function expectNonEmptyString(
  filePath: string,
  key: string,
  value: unknown,
): { ok: true; value: string } | { ok: false; fatal: FatalError } {
  if (typeof value !== "string") {
    return {
      ok: false,
      fatal: configFatal(filePath, key, `\`${key}\` must be a string`),
    };
  }
  if (value.trim().length === 0) {
    return {
      ok: false,
      fatal: configFatal(filePath, key, `\`${key}\` must not be empty`),
    };
  }
  return { ok: true, value };
}

function expectStringArray(
  filePath: string,
  key: string,
  value: unknown,
): { ok: true; value: string[] } | { ok: false; fatal: FatalError } {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      fatal: configFatal(filePath, key, `\`${key}\` must be an array of strings`),
    };
  }
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== "string") {
      return {
        ok: false,
        fatal: configFatal(
          filePath,
          key,
          `\`${key}\` must be an array of strings (invalid entry at index ${i})`,
        ),
      };
    }
    if (item.trim().length === 0) {
      return {
        ok: false,
        fatal: configFatal(
          filePath,
          key,
          `\`${key}\` must not contain empty strings (index ${i})`,
        ),
      };
    }
  }
  return { ok: true, value: [...value] };
}

/**
 * Parse strict JSON config text. Unknown keys, wrong types, and empty strings are errors.
 */
export function parseConfig(text: string, filePath: string): ParseConfigResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      fatal: configFatal(filePath, "", `invalid JSON in config file: ${detail}`),
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      fatal: configFatal(filePath, "", "config root must be a JSON object"),
    };
  }

  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!CONFIG_KEYS.has(key)) {
      const hint = typoHint(key, CONFIG_KEYS);
      const hintText = hint ? ` (did you mean \`${hint}\`?)` : "";
      return {
        ok: false,
        fatal: configFatal(filePath, key, `unknown config key \`${key}\`${hintText}`),
      };
    }
  }

  const config: NodriftConfig = { ...DEFAULT_CONFIG };

  if ("map" in record) {
    const map = expectNonEmptyString(filePath, "map", record.map);
    if (!map.ok) {
      return map;
    }
    config.map = map.value;
  }

  if ("subprocessors" in record) {
    const subprocessors = expectNonEmptyString(
      filePath,
      "subprocessors",
      record.subprocessors,
    );
    if (!subprocessors.ok) {
      return subprocessors;
    }
    config.subprocessors = subprocessors.value;
  }

  if ("migrations" in record) {
    const migrations = expectNonEmptyString(filePath, "migrations", record.migrations);
    if (!migrations.ok) {
      return migrations;
    }
    config.migrations = migrations.value;
  }

  if ("wrangler" in record) {
    const wrangler = expectNonEmptyString(filePath, "wrangler", record.wrangler);
    if (!wrangler.ok) {
      return wrangler;
    }
    config.wrangler = wrangler.value;
  }

  if ("ignoreTables" in record) {
    const ignoreTables = expectStringArray(
      filePath,
      "ignoreTables",
      record.ignoreTables,
    );
    if (!ignoreTables.ok) {
      return ignoreTables;
    }
    config.ignoreTables = ignoreTables.value;
  }

  return { ok: true, config };
}
