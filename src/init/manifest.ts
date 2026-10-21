import { createHash } from "node:crypto";
import type { FatalError } from "../findings.js";
import { fatal } from "../findings.js";

export const MANIFEST_SCHEMA_VERSION = 1;

export type ManifestFileEntry = {
  path: string;
  kind: "owned";
  version: string;
  sha256: string;
};

export type NodriftManifest = {
  schemaVersion: number;
  files: ManifestFileEntry[];
};

export function contentSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function buildManifest(entries: ManifestFileEntry[]): NodriftManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    files: [...entries].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function mergeManifestEntries(
  existing: ManifestFileEntry[],
  updates: ManifestFileEntry[],
): ManifestFileEntry[] {
  const byPath = new Map(existing.map((entry) => [entry.path, entry]));
  for (const entry of updates) {
    byPath.set(entry.path, entry);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export type LoadManifestResult =
  { ok: true; manifest: NodriftManifest | null } | { ok: false; fatal: FatalError };

export function parseManifestJson(
  text: string,
  manifestPath: string,
): LoadManifestResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      fatal: fatal(manifestPath, `invalid manifest JSON: ${detail}`),
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      fatal: fatal(manifestPath, "manifest root must be a JSON object"),
    };
  }

  const record = parsed as Record<string, unknown>;
  if (!("schemaVersion" in record)) {
    return {
      ok: false,
      fatal: fatal(manifestPath, "manifest missing required `schemaVersion`"),
    };
  }

  const schemaVersion = record.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return {
      ok: false,
      fatal: fatal(manifestPath, "`schemaVersion` must be an integer"),
    };
  }

  if (schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    return {
      ok: false,
      fatal: fatal(
        manifestPath,
        `unsupported manifest schemaVersion ${schemaVersion}; upgrade nodrift`,
      ),
    };
  }

  if (!("files" in record) || !Array.isArray(record.files)) {
    return {
      ok: false,
      fatal: fatal(manifestPath, "manifest missing required `files` array"),
    };
  }

  const files: ManifestFileEntry[] = [];
  for (let i = 0; i < record.files.length; i++) {
    const item = record.files[i];
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return {
        ok: false,
        fatal: fatal(manifestPath, `manifest files[${i}] must be an object`),
      };
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      return {
        ok: false,
        fatal: fatal(
          manifestPath,
          `manifest files[${i}].path must be a non-empty string`,
        ),
      };
    }
    if (entry.kind !== "owned") {
      return {
        ok: false,
        fatal: fatal(manifestPath, `manifest files[${i}].kind must be \`owned\``),
      };
    }
    if (typeof entry.version !== "string" || entry.version.length === 0) {
      return {
        ok: false,
        fatal: fatal(
          manifestPath,
          `manifest files[${i}].version must be a non-empty string`,
        ),
      };
    }
    if (typeof entry.sha256 !== "string" || entry.sha256.length === 0) {
      return {
        ok: false,
        fatal: fatal(
          manifestPath,
          `manifest files[${i}].sha256 must be a non-empty string`,
        ),
      };
    }
    files.push({
      path: entry.path,
      kind: "owned",
      version: entry.version,
      sha256: entry.sha256,
    });
  }

  return {
    ok: true,
    manifest: buildManifest(files),
  };
}
