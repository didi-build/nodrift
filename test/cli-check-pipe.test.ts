import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCliPiped } from "./cli-helpers.js";

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
  const root = mkdtempSync(join(tmpdir(), "nodrift-pipe-"));
  tempRoots.push(root);
  return root;
}

describe("nodrift check piped stdout", () => {
  it("flushes complete output through a pipe for large findings", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs/privacy"), { recursive: true });
    mkdirSync(join(root, "migrations"), { recursive: true });
    writeFileSync(
      join(root, "docs/privacy/data-map.yml"),
      "schema_version: 1\n",
      "utf8",
    );

    const statements: string[] = [];
    for (let i = 0; i < 1500; i++) {
      statements.push(`CREATE TABLE t${i} (c0 TEXT);`);
    }
    writeFileSync(
      join(root, "migrations/001_many.sql"),
      `${statements.join("\n")}\n`,
      "utf8",
    );

    const result = await runCliPiped(root, ["check"]);
    expect(result.status).toBe(1);
    const lines = result.stdout.trimEnd().split("\n");
    const last = lines.at(-1);
    expect(last).toMatch(/^nodrift: 1500 problems$/);
    expect(result.stdout.length).toBeGreaterThan(350_000);
  }, 120_000);
});
