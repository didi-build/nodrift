import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, writeWeMetProject } from "./cli-helpers.js";

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
  const root = mkdtempSync(join(tmpdir(), "nodrift-init-"));
  tempRoots.push(root);
  return root;
}

describe("nodrift init CLI", () => {
  it("creates owned scaffolds on an empty project", () => {
    const root = tempRoot();
    const result = runCli(root, ["init"]);
    expect(result.status).toBe(0);
    expect(existsSync(join(root, "docs/privacy/data-map.yml"))).toBe(true);
    expect(existsSync(join(root, "docs/privacy/subprocessors.yml"))).toBe(true);
    expect(existsSync(join(root, ".nodrift/manifest.json"))).toBe(true);
    expect(readFileSync(join(root, "docs/privacy/data-map.yml"), "utf8")).toBe(
      "schema_version: 1\n",
    );
  });

  it("dry-run writes nothing", () => {
    const root = tempRoot();
    const result = runCli(root, ["init", "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("would create");
    expect(existsSync(join(root, "docs/privacy/data-map.yml"))).toBe(false);
  });

  it("skips existing files on a second run", () => {
    const root = tempRoot();
    expect(runCli(root, ["init"]).status).toBe(0);
    const second = runCli(root, ["init"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("skipped");
  });

  it("scaffolds map columns from migrations with whose TODO", () => {
    const root = tempRoot();
    writeWeMetProject(root);
    rmSync(join(root, "docs/privacy/data-map.yml"));
    const result = runCli(root, ["init"]);
    expect(result.status).toBe(0);
    const map = readFileSync(join(root, "docs/privacy/data-map.yml"), "utf8");
    expect(map).toContain("whose: TODO");
    expect(map).toContain("d1_tables:");
  });

  it("records created files in the manifest", () => {
    const root = tempRoot();
    expect(runCli(root, ["init"]).status).toBe(0);
    const manifest = JSON.parse(
      readFileSync(join(root, ".nodrift/manifest.json"), "utf8"),
    ) as {
      schema_version: number;
      kitVersion: string;
      files: Array<{ path: string; kind: string; sha256: string }>;
    };
    expect(manifest.schema_version).toBe(1);
    expect(manifest.files.length).toBeGreaterThan(0);
    expect(manifest.files.every((f) => f.kind === "owned")).toBe(true);
  });

  it("prints privacy checklist when a PR template already exists", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".github"), { recursive: true });
    writeFileSync(
      join(root, ".github/pull_request_template.md"),
      "# existing\n",
      "utf8",
    );
    const result = runCli(root, ["init"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Privacy checklist");
    expect(existsSync(join(root, ".github/pull_request_template.md"))).toBe(true);
    const content = readFileSync(
      join(root, ".github/pull_request_template.md"),
      "utf8",
    );
    expect(content).toBe("# existing\n");
  });

  it("exits 2 when migrations fail during planning", () => {
    const root = tempRoot();
    mkdirSync(join(root, "migrations"), { recursive: true });
    writeFileSync(join(root, "migrations/001_bad.sql"), "NOT SQL;\n", "utf8");
    const result = runCli(root, ["init"]);
    expect(result.status).toBe(2);
    expect(existsSync(join(root, "docs/privacy/data-map.yml"))).toBe(false);
  });
});
