import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  inspectTarballFileList,
  isAllowedPackagePath,
  listTarGzEntries,
  packageCheckExitCode,
  runPackageCheck,
} from "../scripts/check-package.mjs";

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

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

function tarHeaderWithPrefix(nameField: string, prefixField: string, size: number) {
  const header = Buffer.alloc(512);
  header.write(nameField, 0, 100, "utf8");
  header.write(prefixField, 345, 155, "utf8");
  header.write(size.toString(8), 124, 11, "utf8");
  header.write("0", 136, 1, "utf8");
  header[156] = 0x30;
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

function buildTarGzWithUstarPrefix(): Buffer {
  const body = Buffer.from("x", "utf8");
  const tar = Buffer.concat([
    tarHeaderWithPrefix("cli.js", "package/dist/nested", body.length),
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
    expect(isAllowedPackagePath("dist/foo.txt")).toBe(false);
    expect(isAllowedPackagePath("dist/foo.ts")).toBe(false);
    expect(isAllowedPackagePath(".env.example")).toBe(false);
    expect(isAllowedPackagePath("AGENTS.md")).toBe(false);
    expect(isAllowedPackagePath("templates/../AGENTS.md")).toBe(false);
  });
});

describe("packageCheckExitCode", () => {
  it("returns 1 when the packed size exceeds the budget", () => {
    expect(
      packageCheckExitCode({
        packedSize: 99_999,
        maxPackedBytes: 75_000,
        inspect: { ok: true },
      }),
    ).toBe(1);
  });

  it("returns 1 when inspect fails", () => {
    expect(
      packageCheckExitCode({
        packedSize: 100,
        maxPackedBytes: 75_000,
        inspect: {
          ok: false,
          message: "tarball contains disallowed path: .env.example",
        },
      }),
    ).toBe(1);
  });

  it("returns 1 when smoke fails", () => {
    expect(
      packageCheckExitCode({
        packedSize: 100,
        maxPackedBytes: 75_000,
        inspect: { ok: true },
        smokeOk: false,
      }),
    ).toBe(1);
  });

  it("returns 0 when all checks pass", () => {
    expect(
      packageCheckExitCode({
        packedSize: 100,
        maxPackedBytes: 75_000,
        inspect: { ok: true },
        smokeOk: true,
      }),
    ).toBe(0);
  });
});

describe.sequential("runPackageCheck exit code", () => {
  it("returns 1 when the budget is exceeded (no smoke install)", async () => {
    if (!process.env.npm_execpath) {
      expect.fail("npm_execpath must be set (run tests via npm)");
    }
    const code = await runPackageCheck({
      maxPackedBytes: 1_000,
      skipSmoke: true,
      ignorePackScripts: true,
    });
    expect(code).toBe(1);
  });

  it("CLI process exits 1 when NODRIFT_PACKAGE_CHECK_MAX_BYTES is low", () => {
    if (!process.env.npm_execpath) {
      expect.fail("npm_execpath must be set (run tests via npm)");
    }
    const result = spawnSync(
      process.execPath,
      [join(packageRoot, "scripts/check-package.mjs")],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          NODRIFT_PACKAGE_CHECK_MAX_BYTES: "1000",
          NODRIFT_PACKAGE_CHECK_IGNORE_SCRIPTS: "1",
          HUSKY: "0",
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain("exceeds budget");
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

  it("joins ustar prefix and name fields", () => {
    const entries = listTarGzEntries(buildTarGzWithUstarPrefix());
    expect(entries).toContain("package/dist/nested/cli.js");
  });
});
