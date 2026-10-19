import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { checkDataStoresVsMap } from "../src/check2/check-data-stores-vs-map.js";
import { compareBindingsToMap } from "../src/check2/compare.js";
import { extractBindings } from "../src/check2/extract-bindings.js";
import { parseWranglerConfig } from "../src/check2/parse-wrangler.js";
import { expandDataMap } from "../src/data-map/expand.js";
import { parseDataMap } from "../src/data-map/parse.js";
import type { DataMap } from "../src/data-map/types.js";

const weMetDir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures/we-met");
const groupedMapPath = join(weMetDir, "data-map.grouped.yml");
const wranglerFixturePath = join(weMetDir, "wrangler.jsonc");

const minimalMap = `schema_version: 1
d1_tables: {}
other_items: []
`;

function parseMapYaml(yaml: string, filePath = "data-map.yml"): DataMap {
  const result = parseDataMap(yaml, filePath);
  if ("fatal" in result) {
    throw new Error(result.fatal.message);
  }
  if (result.findings.length > 0) {
    throw new Error(
      `map findings: ${result.findings.map((f) => f.message).join("; ")}`,
    );
  }
  return result.map;
}

function buildWeMetCheck2OverlayMapPath(root: string): string {
  const doc = parse(readFileSync(groupedMapPath, "utf8")) as DataMap & {
    other_items: Record<string, unknown>[];
  };
  for (const item of doc.other_items) {
    if (item.id === "queue.visitor_followup") {
      item.binding = "WE_MET_FOLLOWUP_EMAIL_QUEUE";
    }
    if (item.id === "storage.r2.card_photo") {
      item.binding = "WE_MET_ASSETS";
    }
  }
  doc.other_items.push(
    {
      id: "test-only.d1_we_met_db",
      binding: "WE_MET_DB",
      whose: "operational",
      data: "D1 application database (test-only Check 2 overlay)",
      purpose: "document WE_MET_DB binding for Check 2 fixture",
      processors: ["Cloudflare"],
      retention: "TODO",
    },
    {
      id: "test-only.images_binding",
      binding: "IMAGES",
      whose: "operational",
      data: "Cloudflare Images binding (test-only Check 2 overlay)",
      purpose: "document IMAGES binding for Check 2 fixture",
      processors: ["Cloudflare"],
      retention: "TODO",
    },
  );
  const mapPath = join(root, "data-map.overlay.yml");
  writeFileSync(mapPath, stringify(doc), "utf8");
  return mapPath;
}

function writeWranglerDir(root: string, files: Record<string, string>): string {
  const dir = join(root, "wrangler");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf8");
  }
  return dir;
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

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "nodrift-check2-"));
  tempRoots.push(root);
  return root;
}

describe("checkDataStoresVsMap we-met fixture", () => {
  it("reports exactly four binding_not_in_map findings on the grouped map", () => {
    const result = checkDataStoresVsMap({
      mapFilePath: groupedMapPath,
      wranglerDir: weMetDir,
    });
    expect(result.kind).toBe("findings");
    if (result.kind !== "findings") {
      return;
    }
    const bindingFindings = result.findings.filter(
      (f) => f.code === "binding_not_in_map",
    );
    expect(bindingFindings).toHaveLength(4);
    expect(
      bindingFindings.map((f) => /^binding `([^`]+)`/.exec(f.message)?.[1]),
    ).toEqual(["IMAGES", "WE_MET_ASSETS", "WE_MET_DB", "WE_MET_FOLLOWUP_EMAIL_QUEUE"]);
    for (const finding of bindingFindings) {
      expect(finding.message).toContain("top level and previews");
      expect(finding.file).toBe(wranglerFixturePath);
    }
  });

  it("passes when overlay map documents all bindings", () => {
    const root = tempRoot();
    const mapPath = buildWeMetCheck2OverlayMapPath(root);
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.jsonc": readFileSync(wranglerFixturePath, "utf8"),
    });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result).toEqual({
      kind: "ok",
      outcome: "checked",
      bindingCount: 4,
    });
  });
});

describe("checkDataStoresVsMap synthetic wrangler", () => {
  it("covers new R2 and KV bindings when map lists them", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(
      mapPath,
      `schema_version: 1
d1_tables: {}
other_items:
  - id: storage.r2.photos
    binding: PHOTOS
    whose: operational
    data: photos
    purpose: store
    processors: [Cloudflare]
    retention: 1d
  - id: storage.kv.cache
    binding: CACHE
    whose: operational
    data: cache
    purpose: cache
    processors: [Cloudflare]
    retention: 1d
`,
      "utf8",
    );
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.jsonc": JSON.stringify({
        r2_buckets: [{ binding: "PHOTOS", bucket_name: "b" }],
        kv_namespaces: [{ binding: "CACHE", id: "x" }],
      }),
    });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result).toEqual({ kind: "ok", outcome: "checked", bindingCount: 2 });
  });

  it("names env section for bindings only declared under env.staging", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(mapPath, minimalMap, "utf8");
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.jsonc": JSON.stringify({
        env: {
          staging: {
            r2_buckets: [{ binding: "STAGING_ASSETS", bucket_name: "s" }],
          },
        },
      }),
    });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result.kind).toBe("findings");
    if (result.kind === "findings") {
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].message).toContain("env.staging");
    }
  });

  it("merges duplicate binding names across top level and previews", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(mapPath, minimalMap, "utf8");
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.jsonc": JSON.stringify({
        r2_buckets: [{ binding: "ASSETS", bucket_name: "p" }],
        previews: {
          r2_buckets: [{ binding: "ASSETS", bucket_name: "np" }],
        },
      }),
    });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result.kind).toBe("findings");
    if (result.kind === "findings") {
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].message).toContain("top level and previews");
    }
  });

  it("allows one other_items entry to cover multiple bindings", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(
      mapPath,
      `schema_version: 1
d1_tables: {}
other_items:
  - id: storage.all
    binding: [BUCKET_A, BUCKET_B]
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`,
      "utf8",
    );
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.jsonc": JSON.stringify({
        r2_buckets: [
          { binding: "BUCKET_A", bucket_name: "a" },
          { binding: "BUCKET_B", bucket_name: "b" },
        ],
      }),
    });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result).toEqual({ kind: "ok", outcome: "checked", bindingCount: 2 });
  });

  it("ignores out-of-scope bindings (services, assets, vars, ratelimits)", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(mapPath, minimalMap, "utf8");
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.jsonc": JSON.stringify({
        assets: { binding: "ASSETS", directory: "dist" },
        services: [{ binding: "SELF", service: "x" }],
        vars: { FOO: "bar" },
        ratelimits: [
          { name: "LIMITER", namespace_id: "1", simple: { limit: 1, period: 60 } },
        ],
      }),
    });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result).toEqual({ kind: "ok", outcome: "checked", bindingCount: 0 });
  });

  it("allows map items that name ratelimiters without covering queue bindings", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(
      mapPath,
      `schema_version: 1
d1_tables: {}
other_items:
  - id: abuse.rate_limit
    binding: [WE_MET_AUTH_RATE_LIMITER]
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`,
      "utf8",
    );
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.jsonc": JSON.stringify({
        ratelimits: [
          {
            name: "WE_MET_AUTH_RATE_LIMITER",
            namespace_id: "1",
            simple: { limit: 1, period: 60 },
          },
        ],
        queues: {
          producers: [{ binding: "JOB_QUEUE", queue: "q" }],
          consumers: [{ queue: "q", binding: "CONSUMER_SHOULD_NOT_COUNT" }],
        },
      }),
    });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result.kind).toBe("findings");
    if (result.kind === "findings") {
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].code).toBe("binding_not_in_map");
      expect(result.findings[0].message).toContain("JOB_QUEUE");
    }
  });

  it("reports multiple_d1_databases when a section has two D1 bindings", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(mapPath, minimalMap, "utf8");
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.jsonc": JSON.stringify({
        d1_databases: [
          { binding: "DB_A", database_name: "a", database_id: "1" },
          { binding: "DB_B", database_name: "b", database_id: "2" },
        ],
      }),
    });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result.kind).toBe("findings");
    if (result.kind === "findings") {
      const codes = result.findings.map((f) => f.code);
      expect(codes).toContain("multiple_d1_databases");
      expect(codes.filter((c) => c === "binding_not_in_map")).toHaveLength(2);
    }
  });

  it("parses JSONC with comments and trailing commas", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(
      mapPath,
      `schema_version: 1
d1_tables: {}
other_items:
  - id: storage.r2.x
    binding: MY_BUCKET
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`,
      "utf8",
    );
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.jsonc": `{
        // comment
        "r2_buckets": [{ "binding": "MY_BUCKET", "bucket_name": "b", }],
      }`,
    });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result).toEqual({ kind: "ok", outcome: "checked", bindingCount: 1 });
  });

  it("fatal on JSONC syntax error with line and column", () => {
    const root = tempRoot();
    const configPath = join(root, "w.jsonc");
    const parsed = parseWranglerConfig('{\n  "bad": , \n}', configPath);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.fatal.message).toMatch(/line 2, column/);
    }
  });

  it("fatal on empty wrangler config", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(mapPath, minimalMap, "utf8");
    const wranglerDir = writeWranglerDir(root, { "wrangler.jsonc": "   \n" });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result.kind).toBe("fatal");
  });

  it("fatal when root is not an object", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(mapPath, minimalMap, "utf8");
    const wranglerDir = writeWranglerDir(root, { "wrangler.jsonc": "[]" });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result.kind).toBe("fatal");
    if (result.kind === "fatal") {
      expect(result.fatal.message).toContain("root must be a JSON object");
    }
  });

  it("fatal when only wrangler.toml exists", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(mapPath, minimalMap, "utf8");
    const wranglerDir = writeWranglerDir(root, { "wrangler.toml": 'name = "x"\n' });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result.kind).toBe("fatal");
    if (result.kind === "fatal") {
      expect(result.fatal.message).toBe(
        "`wrangler.toml` is not supported in v1; use `wrangler.jsonc`",
      );
    }
  });

  it("prefers wrangler.jsonc when both jsonc and toml exist", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(
      mapPath,
      `schema_version: 1
d1_tables: {}
other_items:
  - id: storage.r2.x
    binding: FROM_JSONC
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`,
      "utf8",
    );
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.jsonc": JSON.stringify({
        r2_buckets: [{ binding: "FROM_JSONC", bucket_name: "b" }],
      }),
      "wrangler.toml": 'name = "ignored"\n',
    });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result).toEqual({ kind: "ok", outcome: "checked", bindingCount: 1 });
  });

  it("falls back to wrangler.json", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(
      mapPath,
      `schema_version: 1
d1_tables: {}
other_items:
  - id: storage.r2.x
    binding: FROM_JSON
    whose: operational
    data: x
    purpose: y
    processors: []
    retention: r
`,
      "utf8",
    );
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.json": JSON.stringify({
        r2_buckets: [{ binding: "FROM_JSON", bucket_name: "b" }],
      }),
    });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result).toEqual({ kind: "ok", outcome: "checked", bindingCount: 1 });
  });

  it("returns nothing_to_check when no wrangler config exists", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(mapPath, minimalMap, "utf8");
    const wranglerDir = join(root, "empty-wrangler");
    mkdirSync(wranglerDir, { recursive: true });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result).toEqual({
      kind: "ok",
      outcome: "nothing_to_check",
      bindingCount: 0,
    });
  });
});

describe("checkDataStoresVsMap loader gates", () => {
  it("returns loader findings without comparing", () => {
    const root = tempRoot();
    const mapPath = join(root, "map.yml");
    writeFileSync(
      mapPath,
      `schema_version: 1
d1_tables: {}
other_items:
  - id: x
    whose: TODO
    data: d
    purpose: p
    processors: []
    retention: r
`,
      "utf8",
    );
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.jsonc": JSON.stringify({
        r2_buckets: [{ binding: "UNMAPPED", bucket_name: "b" }],
      }),
    });
    const result = checkDataStoresVsMap({ mapFilePath: mapPath, wranglerDir });
    expect(result.kind).toBe("findings");
    if (result.kind === "findings") {
      expect(result.findings[0].code).not.toBe("binding_not_in_map");
    }
  });

  it("returns fatal when map file is missing", () => {
    const root = tempRoot();
    const wranglerDir = writeWranglerDir(root, {
      "wrangler.jsonc": "{}",
    });
    const result = checkDataStoresVsMap({
      mapFilePath: join(root, "missing.yml"),
      wranglerDir,
    });
    expect(result.kind).toBe("fatal");
  });
});

describe("compareBindingsToMap fix snippet", () => {
  it("uses exact ready-to-paste YAML for D1 binding", () => {
    const map = parseMapYaml(minimalMap);
    const expanded = expandDataMap(map);
    const { bindings } = extractBindings({
      d1_databases: [{ binding: "WE_MET_DB", database_name: "db", database_id: "1" }],
    });
    const findings = compareBindingsToMap({
      bindings,
      multipleD1Sections: [],
      expanded,
      wranglerConfigPath: "wrangler.jsonc",
    });
    expect(findings[0].fix).toBe(
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
});
