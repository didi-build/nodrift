import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, scaffoldMinimalCheckProject } from "./cli-helpers.js";

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const packageVersion = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
).version as string;

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "nodrift-flags-"));
  tempRoots.push(root);
  return root;
}

function assertCliMisuse(root: string, args: string[]): void {
  const baseline = runCli(root, ["check"]);
  expect(baseline.status).toBe(0);
  expect(baseline.stdout.length).toBeGreaterThan(0);

  const result = runCli(root, args);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Run nodrift --help for usage.");
}

describe("nodrift CLI flags", () => {
  it("prints help", () => {
    const result = runCli(tempRoot(), ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("check   Run privacy drift checks");
  });

  it("prints version from package.json", () => {
    const result = runCli(tempRoot(), ["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(packageVersion);
  });

  it("rejects no command", () => {
    const result = runCli(tempRoot(), []);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage");
  });

  it("rejects unknown command", () => {
    expect(runCli(tempRoot(), ["wat"]).status).toBe(2);
  });

  it("rejects unknown flag in a valid project", () => {
    const root = tempRoot();
    scaffoldMinimalCheckProject(root);
    assertCliMisuse(root, ["check", "--wat"]);
  });

  it("rejects --config without a value in a valid project", () => {
    const root = tempRoot();
    scaffoldMinimalCheckProject(root);
    assertCliMisuse(root, ["check", "--config"]);
  });

  it("rejects --config= with empty value in a valid project", () => {
    const root = tempRoot();
    scaffoldMinimalCheckProject(root);
    assertCliMisuse(root, ["check", "--config="]);
  });

  it("rejects extra positional arguments in a valid project", () => {
    const root = tempRoot();
    scaffoldMinimalCheckProject(root);
    assertCliMisuse(root, ["check", "extra"]);
  });

  it("rejects dry-run with check in a valid project", () => {
    const root = tempRoot();
    scaffoldMinimalCheckProject(root);
    assertCliMisuse(root, ["check", "--dry-run"]);
  });

  it("allows dry-run with init", () => {
    const result = runCli(tempRoot(), ["init", "--dry-run"]);
    expect(result.status).toBe(0);
  });

  it("rejects sync with message", () => {
    const result = runCli(tempRoot(), ["sync"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not available in v1");
  });

  it("rejects missing --config file", () => {
    const result = runCli(tempRoot(), ["check", "--config", "missing.json"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("cannot read config");
  });

  it("honors --config override", () => {
    const root = tempRoot();
    writeFileSync(
      join(root, "alt.config.json"),
      JSON.stringify({
        map: "docs/privacy/data-map.yml",
        migrations: "migrations",
        wrangler: ".",
      }),
      "utf8",
    );
    mkdirSync(join(root, "docs/privacy"), { recursive: true });
    writeFileSync(
      join(root, "docs/privacy/data-map.yml"),
      "schema_version: 1\n",
      "utf8",
    );
    const result = runCli(root, ["check", "--config", "alt.config.json"]);
    expect(result.status).toBe(0);
  });

  it("exits 2 on unexpected errors with a stderr prefix", () => {
    const root = tempRoot();
    scaffoldMinimalCheckProject(root);
    const result = runCli(root, ["check"], { NODRIFT_TEST_THROW: "1" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nodrift: unexpected error:");
    expect(result.stderr).toContain("injected test failure");
    expect(result.stdout).toBe("");
  });
});
