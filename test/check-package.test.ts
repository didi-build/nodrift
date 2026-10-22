import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inspectTarballFileList,
  isAllowedPackagePath,
  listTarGzEntries,
  MAX_PACKED_BYTES,
  packageCheckExitCode,
  resolveMaxPackedBytes,
  runPackageCheck,
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

function packDestinationFromArgs(packArgs: string[]): string {
  const i = packArgs.indexOf("--pack-destination");
  if (i === -1 || i + 1 >= packArgs.length) {
    throw new Error("pack args missing --pack-destination");
  }
  return packArgs[i + 1];
}

describe("resolveMaxPackedBytes", () => {
  const envKey = "NODRIFT_PACKAGE_CHECK_MAX_BYTES";

  afterEach(() => {
    delete process.env[envKey];
  });

  it("fails closed on invalid env values", () => {
    process.env[envKey] = "abc";
    const result = resolveMaxPackedBytes();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("invalid NODRIFT_PACKAGE_CHECK_MAX_BYTES");
      expect(result.message).toContain("abc");
    }
  });

  it("caps env overrides at the default budget (cannot raise)", () => {
    process.env[envKey] = String(MAX_PACKED_BYTES + 50_000);
    const result = resolveMaxPackedBytes();
    expect(result).toEqual({ ok: true, value: MAX_PACKED_BYTES });
  });

  it("allows lowering the budget via env", () => {
    process.env[envKey] = "1000";
    const result = resolveMaxPackedBytes();
    expect(result).toEqual({ ok: true, value: 1000 });
  });

  it("caps programmatic overrides at the default budget", () => {
    const result = resolveMaxPackedBytes({ maxPackedBytes: MAX_PACKED_BYTES + 1 });
    expect(result).toEqual({ ok: true, value: MAX_PACKED_BYTES });
  });
});

describe.sequential("runPackageCheck exit code", () => {
  afterEach(() => {
    delete process.env.NODRIFT_PACKAGE_CHECK_MAX_BYTES;
    vi.restoreAllMocks();
  });

  it("returns 1 when npm pack fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runPackageCheck({
      skipSmoke: true,
      runNpm: () => {
        throw new Error("simulated pack failure");
      },
    });
    expect(code).toBe(1);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "npm pack failed",
    );
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "simulated pack failure",
    );
  });

  it("returns 1 when pack produces other than one .tgz", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runPackageCheck({
      skipSmoke: true,
      runNpm: () => {},
      listPackArchives: () => ["a.tgz", "b.tgz"],
    });
    expect(code).toBe(1);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "expected one .tgz",
    );
  });

  it("returns 1 when the tarball cannot be read", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runPackageCheck({
      skipSmoke: true,
      runNpm: (packArgs) => {
        const dest = packDestinationFromArgs(packArgs);
        writeFileSync(join(dest, "only.tgz"), Buffer.from("not-gzip", "utf8"));
      },
    });
    expect(code).toBe(1);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "read tarball failed",
    );
  });

  it("returns 1 when the budget is exceeded (no smoke install)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runPackageCheck({
      maxPackedBytes: 1_000,
      skipSmoke: true,
      runNpm: (packArgs) => {
        const dest = packDestinationFromArgs(packArgs);
        writeFileSync(join(dest, "pkg.tgz"), Buffer.alloc(5_000));
      },
      listPackageTarballPaths: async () => ["package/dist/cli.js"],
    });
    expect(code).toBe(1);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "exceeds budget",
    );
  });

  it("returns 1 when NODRIFT_PACKAGE_CHECK_MAX_BYTES is invalid", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODRIFT_PACKAGE_CHECK_MAX_BYTES = "abc";
    const code = await runPackageCheck({ skipSmoke: true });
    expect(code).toBe(1);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "invalid NODRIFT_PACKAGE_CHECK_MAX_BYTES",
    );
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
