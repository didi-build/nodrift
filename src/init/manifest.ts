import { createHash } from "node:crypto";

export const MANIFEST_SCHEMA_VERSION = 1;

export type ManifestFileEntry = {
  path: string;
  kind: "owned";
  kitVersion: string;
  sha256: string;
};

export type NodriftManifest = {
  schema_version: number;
  kitVersion: string;
  files: ManifestFileEntry[];
};

export function contentSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function buildManifest(
  kitVersion: string,
  entries: ManifestFileEntry[],
): NodriftManifest {
  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    kitVersion,
    files: entries,
  };
}
