import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  inspectTarballFileList,
  isAllowedPackagePath,
  listTarGzEntries,
} from "../scripts/check-package.mjs";

function padTar(content: Buffer): Buffer {
  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  content.copy(padded);
  return padded;
}

function tarHeader(path: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(path, 0, Math.min(path.length, 100), "utf8");
  header.write(size.toString(8), 124, 11, "utf8");
  header.write("0", 136, 1, "utf8"); // checksum placeholder
  header[156] = 0x30; // regular file
  let sum = 0;
  for (let i = 0; i < 512; i++) {
    sum += header[i] ?? 0;
  }
  header.write(sum.toString(8), 148, 7, "utf8");
  header[155] = 0;
  return header;
}

function buildSampleTarGz(): Buffer {
  const filePath = "package/dist/cli.js";
  const body = Buffer.from('console.log("cli");\n', "utf8");
  const tar = Buffer.concat([
    tarHeader(filePath, body.length),
    padTar(body),
    Buffer.alloc(512),
  ]);
  return gzipSync(tar);
}

describe("check-package allowlist", () => {
  it("accepts required package paths", () => {
    expect(isAllowedPackagePath("package.json")).toBe(true);
    expect(isAllowedPackagePath("LICENSE")).toBe(true);
    expect(isAllowedPackagePath("README.md")).toBe(true);
    expect(isAllowedPackagePath("LICENSES/launchpad-MIT.txt")).toBe(true);
    expect(isAllowedPackagePath("templates/breach-response.md")).toBe(true);
    expect(isAllowedPackagePath("dist/cli.js")).toBe(true);
    expect(isAllowedPackagePath("dist/init/run-init.js")).toBe(true);
  });

  it("rejects paths outside the allowlist", () => {
    expect(isAllowedPackagePath("src/cli.ts")).toBe(false);
    expect(isAllowedPackagePath("dist/cli.d.ts")).toBe(false);
    expect(isAllowedPackagePath("dist/cli.js.map")).toBe(false);
    expect(isAllowedPackagePath(".env.example")).toBe(false);
    expect(isAllowedPackagePath("AGENTS.md")).toBe(false);
    expect(isAllowedPackagePath("templates/../AGENTS.md")).toBe(false);
  });
});

describe("inspectTarballFileList", () => {
  const templates = ["templates/breach-response.md"];

  it("fails when dist/cli.js is missing", () => {
    const result = inspectTarballFileList(
      ["package/package.json", "package/templates/breach-response.md"],
      templates,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("dist/cli.js");
    }
  });

  it("names a missing required template", () => {
    const result = inspectTarballFileList(
      ["package/dist/cli.js", "package/package.json"],
      templates,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("templates/breach-response.md");
    }
  });

  it("names a disallowed path", () => {
    const result = inspectTarballFileList(
      [
        "package/dist/cli.js",
        "package/templates/breach-response.md",
        "package/src/x.ts",
      ],
      templates,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("src/x.ts");
    }
  });
});

describe("listTarGzEntries", () => {
  it("parses a minimal tarball including the package/ prefix", () => {
    const entries = listTarGzEntries(buildSampleTarGz());
    expect(entries).toContain("package/dist/cli.js");
  });
});
