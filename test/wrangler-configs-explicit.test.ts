import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDataStoresVsMap } from "../src/check2/check-data-stores-vs-map.js";
import { resolveExplicitWranglerConfigPaths } from "../src/check2/resolve-explicit-wrangler-configs.js";
import { runCli } from "./cli-helpers.js";

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "nodrift-wrangler-configs-"));
  tempRoots.push(root);
  return root;
}

const minimalMap = `schema_version: 1
d1_tables: {}
other_items: []
`;

describe("resolveExplicitWranglerConfigPaths", () => {
  it("dedupes equivalent paths", () => {
    const root = makeRoot();
    const dir = join(root, "w");
    mkdirSync(dir);
    const config = join(dir, "wrangler.jsonc");
    writeFileSync(config, "{}", "utf8");
    const viaLink = join(root, "link/wrangler.jsonc");
    symlinkSync(dir, join(root, "link"), "dir");
    const result = resolveExplicitWranglerConfigPaths([config, viaLink]);
    expect(result).toEqual({ ok: true, configPaths: [config] });
  });

  it("rejects duplicate identical paths", () => {
    const root = makeRoot();
    const config = join(root, "wrangler.jsonc");
    writeFileSync(config, "{}", "utf8");
    const result = resolveExplicitWranglerConfigPaths([config, config]);
    expect(result.ok).toBe(false);
  });

  it("rejects wrangler.toml", () => {
    const root = makeRoot();
    const toml = join(root, "wrangler.toml");
    writeFileSync(toml, 'name = "x"\n', "utf8");
    const result = resolveExplicitWranglerConfigPaths([toml]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fatal.message).toContain("wrangler.toml");
    }
  });

  it("rejects wrong basenames", () => {
    const root = makeRoot();
    const bad = join(root, "config.json");
    writeFileSync(bad, "{}", "utf8");
    const result = resolveExplicitWranglerConfigPaths([bad]);
    expect(result.ok).toBe(false);
  });

  it("rejects missing files", () => {
    const root = makeRoot();
    const result = resolveExplicitWranglerConfigPaths([
      join(root, "missing/wrangler.jsonc"),
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects directories", () => {
    const root = makeRoot();
    const dir = join(root, "wrangler.jsonc");
    mkdirSync(dir);
    const result = resolveExplicitWranglerConfigPaths([dir]);
    expect(result.ok).toBe(false);
  });
});

describe("wranglerConfigs explicit mode", () => {
  it("does not discover when wranglerConfigs is an empty array", () => {
    const repoRoot = makeRoot();
    writeFileSync(join(repoRoot, "wrangler.jsonc"), "{}", "utf8");
    mkdirSync(join(repoRoot, "nested"), { recursive: true });
    writeFileSync(
      join(repoRoot, "nested/wrangler.jsonc"),
      JSON.stringify({ images: { binding: "NESTED" } }),
      "utf8",
    );
    writeFileSync(join(repoRoot, "data-map.yml"), minimalMap, "utf8");
    const result = checkDataStoresVsMap({
      mapFilePath: join(repoRoot, "data-map.yml"),
      repoRoot,
      wranglerConfigsExplicit: true,
      wranglerConfigPaths: [],
    });
    expect(result).toEqual({
      kind: "ok",
      outcome: "nothing_to_check",
      bindingCount: 0,
    });
  });

  it("resolves paths relative to the repo root via load-config", () => {
    const repoRoot = makeRoot();
    mkdirSync(join(repoRoot, "w"), { recursive: true });
    const config = join(repoRoot, "w/wrangler.jsonc");
    writeFileSync(config, JSON.stringify({ images: { binding: "X" } }), "utf8");
    writeFileSync(join(repoRoot, "data-map.yml"), minimalMap, "utf8");
    const result = checkDataStoresVsMap({
      mapFilePath: join(repoRoot, "data-map.yml"),
      repoRoot,
      wranglerConfigsExplicit: true,
      wranglerConfigPaths: [join(repoRoot, "./w/wrangler.jsonc")],
    });
    expect(result.kind).toBe("findings");
  });

  it("prints a warning when wrangler is ignored because wranglerConfigs is set", () => {
    const root = makeRoot();
    mkdirSync(join(root, "docs/privacy"), { recursive: true });
    writeFileSync(
      join(root, "docs/privacy/data-map.yml"),
      "schema_version: 1\n",
      "utf8",
    );
    writeFileSync(join(root, "wrangler.jsonc"), "{}", "utf8");
    writeFileSync(
      join(root, "nodrift.config.json"),
      JSON.stringify({
        wrangler: "ignored-root",
        wranglerConfigs: ["wrangler.jsonc"],
      }),
      "utf8",
    );
    const result = runCli(root, ["check"]);
    expect(result.stdout).toContain(
      "wrangler is ignored when wranglerConfigs is set (wrangler: ignored-root)",
    );
  });
});
