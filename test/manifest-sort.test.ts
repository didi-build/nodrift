import { describe, expect, it } from "vitest";
import {
  buildManifest,
  compareManifestPaths,
  type ManifestFileEntry,
} from "../src/init/manifest.js";

function entry(path: string): ManifestFileEntry {
  return { path, kind: "owned", version: "1", sha256: "abc" };
}

describe("manifest path ordering", () => {
  it("sorts by UTF-16 code units, not locale collation", () => {
    expect(compareManifestPaths("B.md", "a.md")).toBeLessThan(0);
    expect(compareManifestPaths("a.md", "é.md")).toBeLessThan(0);

    const manifest = buildManifest([entry("é.md"), entry("B.md"), entry("a.md")]);
    expect(manifest.files.map((f) => f.path)).toEqual(["B.md", "a.md", "é.md"]);
  });
});
