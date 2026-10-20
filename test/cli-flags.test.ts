import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./cli-helpers.js";

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

  it("rejects unknown flag", () => {
    expect(runCli(tempRoot(), ["check", "--wat"]).status).toBe(2);
  });

  it("rejects dry-run with check", () => {
    expect(runCli(tempRoot(), ["check", "--dry-run"]).status).toBe(2);
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
});
