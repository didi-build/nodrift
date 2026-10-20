import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const root = mkdtempSync(join(tmpdir(), "nodrift-cli-"));
  tempRoots.push(root);
  return root;
}

describe("nodrift check CLI", () => {
  it("passes on we-met-like fixture", () => {
    const root = tempRoot();
    writeWeMetProject(root);
    const result = runCli(root, ["check"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("11 tables, 70 columns");
    expect(result.stdout).toContain("4 bindings");
    expect(result.stdout).toContain("nodrift: ok");
  });

  it("reports undeclared column as exit 1", () => {
    const root = tempRoot();
    writeWeMetProject(root);
    writeFileSync(
      join(root, "migrations/9999_extra.sql"),
      "ALTER TABLE cards ADD COLUMN sneaky_col TEXT;\n",
      "utf8",
    );
    const result = runCli(root, ["check"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("column_not_in_map");
    expect(result.stdout).toMatch(/fix:/);
  });

  it("reports missing binding coverage as exit 1", () => {
    const root = tempRoot();
    writeWeMetProject(root);
    const mapPath = join(root, "docs/privacy/data-map.yml");
    let map = readFile(mapPath);
    map = map.replace("binding: WE_MET_DB", "binding: REMOVED_BINDING");
    writeFileSync(mapPath, map, "utf8");
    const result = runCli(root, ["check"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("binding_not_in_map");
  });

  it("prints loader findings once without running checks", () => {
    const root = tempRoot();
    writeWeMetProject(root);
    const mapPath = join(root, "docs/privacy/data-map.yml");
    let map = readFile(mapPath);
    map = map.replace(/whose: card_owner/g, "whose: TODO");
    writeFileSync(mapPath, map, "utf8");
    const result = runCli(root, ["check"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("classify this");
    expect(result.stdout).not.toContain("check 1 (map vs migrations)");
    expect((result.stdout.match(/classify this/g) ?? []).length).toBeGreaterThan(0);
  });

  it("exits 2 on malformed map YAML", () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs/privacy"), { recursive: true });
    writeFileSync(
      join(root, "docs/privacy/data-map.yml"),
      "d1_tables: [\n  - unclosed",
      "utf8",
    );
    const result = runCli(root, ["check"]);
    expect(result.status).toBe(2);
  });

  it("reports migration fatal and check 2 finding together", () => {
    const root = tempRoot();
    writeWeMetProject(root);
    writeFileSync(join(root, "migrations/9999_bad.sql"), "NOT VALID SQL;\n", "utf8");
    const mapPath = join(root, "docs/privacy/data-map.yml");
    let map = readFile(mapPath);
    map = map.replace("binding: WE_MET_DB", "binding: REMOVED_BINDING");
    writeFileSync(mapPath, map, "utf8");
    const result = runCli(root, ["check"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("migration");
    expect(result.stdout).toContain("binding_not_in_map");
  });

  it("passes on empty project with minimal map", () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs/privacy"), { recursive: true });
    writeFileSync(
      join(root, "docs/privacy/data-map.yml"),
      "schema_version: 1\n",
      "utf8",
    );
    const result = runCli(root, ["check"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nothing to check");
    expect(result.stdout).toContain("nodrift: ok");
  });

  it("exits 2 on typo migrations path in config", () => {
    const root = tempRoot();
    writeWeMetProject(root);
    writeFileSync(
      join(root, "nodrift.config.json"),
      JSON.stringify({ migrations: "no-such-migrations-dir" }),
      "utf8",
    );
    const result = runCli(root, ["check"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("check the `migrations` path");
  });

  it("exits 2 on bad wrangler path in config", () => {
    const root = tempRoot();
    writeWeMetProject(root);
    writeFileSync(
      join(root, "nodrift.config.json"),
      JSON.stringify({ wrangler: "missing-wrangler-dir" }),
      "utf8",
    );
    const result = runCli(root, ["check"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("check the `wrangler` path");
  });

  it("exits 1 on malformed subprocessors.yml", () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs/privacy"), { recursive: true });
    writeFileSync(
      join(root, "docs/privacy/data-map.yml"),
      "schema_version: 1\n",
      "utf8",
    );
    writeFileSync(
      join(root, "docs/privacy/subprocessors.yml"),
      "schema_version: 0\nsubprocessors: []\n",
      "utf8",
    );
    const result = runCli(root, ["check"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("subprocessors");
  });

  it("exits 2 when subprocessors path is not a readable file", () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs/privacy"), { recursive: true });
    writeFileSync(
      join(root, "docs/privacy/data-map.yml"),
      "schema_version: 1\n",
      "utf8",
    );
    mkdirSync(join(root, "docs/privacy/subprocessors.yml"), { recursive: true });
    const result = runCli(root, ["check"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("cannot read file");
  });
});

function readFile(path: string): string {
  return readFileSync(path, "utf8");
}
