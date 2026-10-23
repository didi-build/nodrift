import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkDataStoresVsMap } from "../src/check2/check-data-stores-vs-map.js";
import { compareBindingsToMap, collectCoveredBindings } from "../src/check2/compare.js";
import { extractBindings } from "../src/check2/extract-bindings.js";
import { expandDataMap } from "../src/data-map/expand.js";
import { parseDataMap } from "../src/data-map/parse.js";
import { weMetGroupedMapWithBindingOverlay } from "./check2-overlay.js";

const weMetDir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures/we-met");
const weMetWranglerDir = weMetDir;
const weMetMapPath = join(weMetDir, "data-map.grouped.yml");

const minimalMap = `schema_version: 1
d1_tables: {}
other_items: []
`;

function parseMap(yaml: string, filePath = "data-map.yml") {
  const result = parseDataMap(yaml, filePath);
  if ("fatal" in result) {
    throw new Error(result.fatal.message);
  }
  return result.map;
}

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function makeWranglerDir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "nodrift-check2-"));
  tempRoots.push(root);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content, "utf8");
  }
  return root;
}

function makeMapDir(yaml: string): string {
  const root = mkdtempSync(join(tmpdir(), "nodrift-check2-map-"));
  tempRoots.push(root);
  writeFileSync(join(root, "data-map.yml"), yaml, "utf8");
  return root;
}

function makeRepoTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "nodrift-check2-repo-"));
  tempRoots.push(root);
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

describe("checkDataStoresVsMap", () => {
  describe("we-met fixture", () => {
    it("reports exactly four binding_not_in_map findings on the grouped map", () => {
      const result = checkDataStoresVsMap({
        mapFilePath: weMetMapPath,
        wranglerDir: weMetWranglerDir,
      });
      expect(result.kind).toBe("findings");
      if (result.kind !== "findings") {
        return;
      }
      expect(result.findings).toHaveLength(4);
      expect(result.findings.every((f) => f.code === "binding_not_in_map")).toBe(true);
      const names = result.findings.map(
        (f) => /binding `([^`]+)`/.exec(f.message)?.[1],
      );
      expect(names.sort()).toEqual([
        "IMAGES",
        "WE_MET_ASSETS",
        "WE_MET_DB",
        "WE_MET_FOLLOWUP_EMAIL_QUEUE",
      ]);
      for (const finding of result.findings) {
        expect(finding.message).toContain("top level and previews");
      }
      const dbFinding = result.findings.find((f) => f.message.includes("WE_MET_DB"));
      expect(dbFinding?.fix).toBe(
        `other_items:
  - id: d1.we_met_db
    binding: WE_MET_DB
    whose: TODO
    data: TODO
    purpose: TODO
    processors: [Cloudflare]
    retention: TODO`,
      );
    });

    it("passes when the test-only binding overlay is applied", () => {
      const mapDir = makeMapDir(weMetGroupedMapWithBindingOverlay(weMetMapPath));
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir: weMetWranglerDir,
      });
      expect(result).toEqual({
        kind: "ok",
        outcome: "checked",
        bindingCount: 4,
      });
    });
  });

  describe("synthetic wrangler configs", () => {
    it("detects a new R2 bucket binding", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          r2_buckets: [{ binding: "NEW_BUCKET", bucket_name: "b" }],
        }),
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        expect(result.findings[0].code).toBe("binding_not_in_map");
        expect(result.findings[0].message).toContain("NEW_BUCKET");
        expect(result.findings[0].message).toContain("top level");
      }
    });

    it("detects a new KV namespace binding", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.json": JSON.stringify({
          kv_namespaces: [{ binding: "MY_KV", id: "x" }],
        }),
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        expect(result.findings[0].message).toContain("MY_KV");
        expect(result.findings[0].message).toContain("(KV)");
      }
    });

    it("detects bindings only declared under env.<name>", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          env: {
            staging: {
              r2_buckets: [{ binding: "STAGING_ASSETS", bucket_name: "s" }],
            },
          },
        }),
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        expect(result.findings[0].message).toContain("env.staging");
        expect(result.findings[0].path).toBe("env.staging.r2_buckets[0].binding");
      }
    });

    it("detects bindings only in previews", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          previews: {
            images: { binding: "IMAGES" },
          },
        }),
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        expect(result.findings[0].message).toContain("previews");
        expect(result.findings[0].path).toBe("previews.images.binding");
      }
    });

    it("uses the top-level path when a binding is declared in top level, env, and previews", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          kv_namespaces: [{ binding: "SHARED_KV", id: "1" }],
          env: {
            staging: {
              kv_namespaces: [{ binding: "SHARED_KV", id: "2" }],
            },
          },
          previews: {
            kv_namespaces: [{ binding: "SHARED_KV", id: "3" }],
          },
        }),
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].path).toBe("kv_namespaces[0].binding");
      }
    });

    it("merges duplicate binding names across top level and previews into one finding", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          images: { binding: "IMAGES" },
          previews: { images: { binding: "IMAGES" } },
        }),
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].message).toContain("top level and previews");
        expect(result.findings[0].path).toBe("images.binding");
      }
    });

    it("allows one other_items entry to cover several bindings", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          r2_buckets: [{ binding: "A", bucket_name: "a" }],
          kv_namespaces: [{ binding: "B", id: "1" }],
        }),
      });
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: stores.combo
    binding: [A, B]
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`;
      const mapDir = makeMapDir(mapYaml);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result).toEqual({
        kind: "ok",
        outcome: "checked",
        bindingCount: 2,
      });
    });

    it("accepts binding as a string or list on the map side", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          images: { binding: "IMAGES" },
        }),
      });
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: images.one
    binding: IMAGES
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`;
      const mapDir = makeMapDir(mapYaml);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("ok");
    });

    it("ignores out-of-scope wrangler kinds", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          services: [{ binding: "SVC", service: "x" }],
          assets: { binding: "ASSETS", directory: "." },
          vars: { FOO: "bar" },
          ratelimits: [
            { name: "RL", namespace_id: "1", simple: { limit: 1, period: 60 } },
          ],
        }),
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result).toEqual({
        kind: "ok",
        outcome: "checked",
        bindingCount: 0,
      });
    });

    it("allows map items that list rate-limiter names without wrangler bindings", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          ratelimits: [
            { name: "RL", namespace_id: "1", simple: { limit: 1, period: 60 } },
          ],
        }),
      });
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: ratelimit.rl
    binding: RL
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`;
      const mapDir = makeMapDir(mapYaml);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result).toEqual({
        kind: "ok",
        outcome: "checked",
        bindingCount: 0,
      });
    });

    it("reports multiple_d1_databases in one section", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          d1_databases: [
            { binding: "DB1", database_name: "a", database_id: "1" },
            { binding: "DB2", database_name: "b", database_id: "2" },
          ],
        }),
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        const multi = result.findings.filter((f) => f.code === "multiple_d1_databases");
        expect(multi).toHaveLength(1);
        expect(multi[0].message).toContain("top level");
        expect(multi[0].message).toContain("not supported yet by nodrift");
        expect(multi[0].message).toContain("`DB1`");
        expect(multi[0].message).toContain("`DB2`");
        expect(multi[0].message).toContain("0003-nodrift-v1-design.md");
        expect(multi[0].path).toBe("d1_databases");
        expect(result.findings.some((f) => f.code === "binding_not_in_map")).toBe(true);
      }
    });

    it("allows one D1 database per section across top level and env", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          d1_databases: [
            { binding: "APP_DB", database_name: "prod", database_id: "1" },
          ],
          env: {
            staging: {
              d1_databases: [
                { binding: "APP_DB", database_name: "staging", database_id: "2" },
              ],
            },
          },
        }),
      });
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: d1.app_db
    binding: APP_DB
    whose: operational
    data: x
    purpose: y
    processors: [Cloudflare]
    retention: r
`;
      const mapDir = makeMapDir(mapYaml);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result).toEqual({
        kind: "ok",
        outcome: "checked",
        bindingCount: 1,
      });
    });

    it("reports durable_objects bindings as unsupported", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          durable_objects: {
            bindings: [{ name: "MY_COUNTER", class_name: "Counter" }],
          },
        }),
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        const durable = result.findings.filter((f) => f.code === "durable_objects");
        expect(durable).toHaveLength(1);
        expect(durable[0].message).toContain("`MY_COUNTER`");
        expect(durable[0].message).toContain("not supported yet by nodrift");
        expect(durable[0].path).toBe("durable_objects.bindings[0].name");
      }
    });

    it("points multiple_d1_databases at env and previews d1_databases arrays", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          env: {
            staging: {
              d1_databases: [
                { binding: "A", database_name: "a", database_id: "1" },
                { binding: "B", database_name: "b", database_id: "2" },
              ],
            },
          },
          previews: {
            d1_databases: [
              { binding: "C", database_name: "c", database_id: "3" },
              { binding: "D", database_name: "d", database_id: "4" },
            ],
          },
        }),
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        const multi = result.findings.filter((f) => f.code === "multiple_d1_databases");
        expect(multi.map((f) => f.path).sort()).toEqual([
          "env.staging.d1_databases",
          "previews.d1_databases",
        ]);
      }
    });

    it("checks bindings under an env block named __proto__", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": `{
  "env": {
    "__proto__": {
      "kv_namespaces": [{ "binding": "PROTO_KV", "id": "x" }]
    }
  }
}`,
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        expect(result.findings[0].path).toBe("env.__proto__.kv_namespaces[0].binding");
      }
    });

    it("does not treat queue consumers as bindings", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({
          queues: {
            consumers: [{ queue: "q", binding: "CONSUMER_SHOULD_NOT_COUNT" }],
          },
        }),
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result).toEqual({
        kind: "ok",
        outcome: "checked",
        bindingCount: 0,
      });
    });

    it("parses JSONC with comments and trailing commas", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": `{
          // comment
          "images": { "binding": "IMAGES", },
        }`,
      });
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: images.one
    binding: IMAGES
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`;
      const mapDir = makeMapDir(mapYaml);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("ok");
    });

    it("returns fatal on JSON syntax error with path, code name, and line/column", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": '{ "b": }',
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toBe(
          "JSONC syntax error at b: ValueExpected (line 1, column 8)",
        );
      }
    });

    it("formats JSONC syntax errors without a property path", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": "{ broken",
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toMatch(
          /^JSONC syntax error: \w+ \(line 1, column \d+\)$/,
        );
      }
    });

    it("reports JSONC syntax line/column with CRLF newlines", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": '{\r\n  "a": ,\r\n}',
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toBe(
          "JSONC syntax error at a: ValueExpected (line 2, column 8)",
        );
      }
    });

    it("parses a UTF-8 BOM before valid JSON", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": `\uFEFF${JSON.stringify({ images: { binding: "IMAGES" } })}`,
      });
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: images.one
    binding: IMAGES
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`;
      const mapDir = makeMapDir(mapYaml);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("ok");
    });

    it("treats a BOM-only wrangler file as empty", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": "\uFEFF",
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toContain("empty");
      }
    });

    it("reports syntax errors after a BOM at the correct line and column", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": `\uFEFF{ "x": }`,
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toBe(
          "JSONC syntax error at x: ValueExpected (line 1, column 8)",
        );
      }
    });

    it("returns fatal on empty wrangler file", () => {
      const wranglerDir = makeWranglerDir({ "wrangler.jsonc": "" });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toContain("empty");
      }
    });

    it("returns fatal when wrangler root is not an object", () => {
      const wranglerDir = makeWranglerDir({ "wrangler.jsonc": "[]" });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toContain("JSON object");
      }
    });

    it("returns fatal when only wrangler.toml exists", () => {
      const wranglerDir = makeWranglerDir({ "wrangler.toml": 'name = "x"\n' });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toContain("wrangler.toml");
        expect(result.fatal.message).toContain("wrangler.jsonc");
      }
    });

    it("prefers wrangler.jsonc when both jsonc and toml exist", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({ images: { binding: "IMAGES" } }),
        "wrangler.toml": 'name = "ignored"\n',
      });
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: images.one
    binding: IMAGES
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`;
      const mapDir = makeMapDir(mapYaml);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("ok");
    });

    it("falls back to wrangler.json", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.json": JSON.stringify({ images: { binding: "IMAGES" } }),
      });
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: images.one
    binding: IMAGES
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`;
      const mapDir = makeMapDir(mapYaml);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("ok");
    });

    it("returns nothing_to_check when no wrangler config exists and the map has no bindings", () => {
      const wranglerDir = makeWranglerDir({});
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result).toEqual({
        kind: "ok",
        outcome: "nothing_to_check",
        bindingCount: 0,
      });
    });

    it("returns fatal when the map lists bindings but the wrangler directory has no config", () => {
      const wranglerDir = makeWranglerDir({});
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: a
    binding: [ALPHA, BETA]
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`;
      const mapDir = makeMapDir(mapYaml);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toBe(
          `the map references bindings (ALPHA, BETA) but no Wrangler config was found in ${wranglerDir}; check the \`wrangler\` path`,
        );
      }
    });

    it("returns fatal when wranglerDir does not exist and the map lists bindings", () => {
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: a
    binding: MISSING_PATH_KV
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`;
      const mapDir = makeMapDir(mapYaml);
      const missingDir = join(mapDir, "no-such-wrangler-dir");
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir: missingDir,
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toBe(
          `Wrangler directory not found or not a directory: ${missingDir}; check the \`wrangler\` path`,
        );
      }
    });

    it("returns fatal when wranglerDir is a regular file", () => {
      const root = mkdtempSync(join(tmpdir(), "nodrift-check2-file-"));
      tempRoots.push(root);
      const wranglerPath = join(root, "wrangler-as-file");
      writeFileSync(wranglerPath, "not a directory", "utf8");
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir: wranglerPath,
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toContain(
          "Wrangler directory not found or not a directory",
        );
        expect(result.fatal.message).toContain(wranglerPath);
      }
    });

    it("returns fatal when wrangler.jsonc is a directory", () => {
      const wranglerDir = makeWranglerDir({});
      mkdirSync(join(wranglerDir, "wrangler.jsonc"));
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toContain(join(wranglerDir, "wrangler.jsonc"));
        expect(result.fatal.message).toContain("EISDIR");
      }
    });
  });

  describe("wrangler filesystem hooks", () => {
    it("treats readdir EACCES as fatal naming the directory", () => {
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir: "/blocked/wrangler",
        wranglerConfigFs: {
          readdirSync() {
            const err = new Error("permission denied") as NodeJS.ErrnoException;
            err.code = "EACCES";
            throw err;
          },
        },
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.file).toBe("/blocked/wrangler");
        expect(result.fatal.message).toContain("permission denied");
        expect(result.fatal.message).not.toContain("nothing_to_check");
      }
    });

    it("treats readdir EPERM as fatal naming the directory", () => {
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir: "/blocked/wrangler",
        wranglerConfigFs: {
          readdirSync() {
            const err = new Error("operation not permitted") as NodeJS.ErrnoException;
            err.code = "EPERM";
            throw err;
          },
        },
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.message).toContain("operation not permitted");
      }
    });

    it("treats readFile EACCES as fatal naming the config file", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": "{}",
      });
      const configPath = join(wranglerDir, "wrangler.jsonc");
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
        wranglerReadFs: {
          readFileSync(path) {
            if (path === configPath) {
              const err = new Error("permission denied") as NodeJS.ErrnoException;
              err.code = "EACCES";
              throw err;
            }
            throw new Error(`unexpected read: ${path}`);
          },
        },
      });
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.fatal.file).toBe(configPath);
        expect(result.fatal.message).toContain("permission denied");
      }
    });
  });

  describe("loader stops before comparison", () => {
    it("returns loader findings first", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({ images: { binding: "IMAGES" } }),
      });
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: bad
    whose: operational
    data: x
    purpose: y
    processors: []
`;
      const mapDir = makeMapDir(mapYaml);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        expect(result.findings[0].code).not.toBe("binding_not_in_map");
      }
    });

    it("returns fatal on missing map file", () => {
      const wranglerDir = makeWranglerDir({
        "wrangler.jsonc": JSON.stringify({ images: { binding: "IMAGES" } }),
      });
      const result = checkDataStoresVsMap({
        mapFilePath: join(weMetDir, "does-not-exist.yml"),
        wranglerDir,
      });
      expect(result.kind).toBe("fatal");
    });
  });

  describe("compareBindingsToMap ordering", () => {
    it("orders binding_not_in_map findings by binding name", () => {
      const bindings = extractBindings({
        r2_buckets: [{ binding: "Z_LAST", bucket_name: "z" }],
        kv_namespaces: [{ binding: "A_FIRST", id: "1" }],
        images: { binding: "M_MIDDLE" },
      }).bindings;
      const findings = compareBindingsToMap(
        bindings,
        new Set(),
        "wrangler.jsonc",
        [],
        [],
      );
      const names = findings.map((f) => /binding `([^`]+)`/.exec(f.message)?.[1]);
      expect(names).toEqual(["A_FIRST", "M_MIDDLE", "Z_LAST"]);
    });
  });

  describe("repo-wide Wrangler discovery", () => {
    it("reports binding_not_in_map from a nested worker config with the file path", () => {
      const repoRoot = makeRepoTree({
        "wrangler.jsonc": JSON.stringify({
          images: { binding: "ROOT_IMAGES" },
        }),
        "workers/followup-email/wrangler.jsonc": JSON.stringify({
          queues: {
            producers: [{ binding: "NESTED_QUEUE", queue: "q" }],
          },
        }),
      });
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: images
    binding: ROOT_IMAGES
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`;
      const mapDir = makeMapDir(mapYaml);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        repoRoot,
        wranglerSearchDir: repoRoot,
      });
      expect(result.kind).toBe("findings");
      if (result.kind !== "findings") {
        return;
      }
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].code).toBe("binding_not_in_map");
      expect(result.findings[0].message).toContain("NESTED_QUEUE");
      expect(result.findings[0].file).toBe(
        join(repoRoot, "workers/followup-email/wrangler.jsonc"),
      );
    });

    it("honors wranglerConfigs explicit paths", () => {
      const repoRoot = makeRepoTree({
        "wrangler.jsonc": JSON.stringify({
          images: { binding: "ROOT_IMAGES" },
        }),
        "workers/ignored/wrangler.jsonc": JSON.stringify({
          images: { binding: "IGNORED_IMAGES" },
        }),
      });
      const mapYaml = `schema_version: 1
d1_tables: {}
other_items: []
`;
      const mapDir = makeMapDir(mapYaml);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        repoRoot,
        wranglerConfigPaths: [join(repoRoot, "wrangler.jsonc")],
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].message).toContain("ROOT_IMAGES");
        expect(result.findings[0].file).toBe(join(repoRoot, "wrangler.jsonc"));
      }
    });

    it("checks wrangler.toml when discovered", () => {
      const repoRoot = makeRepoTree({
        "wrangler.jsonc": "{}",
        "workers/kv-consumer/wrangler.toml": `name = "kv-consumer"

[[kv_namespaces]]
binding = "TOML_KV"
id = "abc"
`,
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        repoRoot,
        wranglerSearchDir: repoRoot,
      });
      expect(result.kind).toBe("findings");
      if (result.kind === "findings") {
        const tomlFinding = result.findings.find((f) => f.message.includes("TOML_KV"));
        expect(tomlFinding?.file).toBe(
          join(repoRoot, "workers/kv-consumer/wrangler.toml"),
        );
      }
    });

    it("does not scan node_modules for wrangler configs", () => {
      const repoRoot = makeRepoTree({
        "wrangler.jsonc": "{}",
        "node_modules/pkg/wrangler.jsonc": JSON.stringify({
          images: { binding: "HIDDEN_IMAGES" },
        }),
      });
      const mapDir = makeMapDir(minimalMap);
      const result = checkDataStoresVsMap({
        mapFilePath: join(mapDir, "data-map.yml"),
        repoRoot,
        wranglerSearchDir: repoRoot,
      });
      expect(result).toEqual({
        kind: "ok",
        outcome: "checked",
        bindingCount: 0,
      });
    });
  });

  describe("collectCoveredBindings", () => {
    it("collects string and list bindings from expanded entries", () => {
      const map = parseMap(`schema_version: 1
d1_tables: {}
other_items:
  - id: a
    binding: ONE
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
  - id: b
    binding: [TWO, THREE]
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`);
      const covered = collectCoveredBindings(expandDataMap(map));
      expect([...covered].sort()).toEqual(["ONE", "THREE", "TWO"]);
    });
  });
});
