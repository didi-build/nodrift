import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { expandDataMap } from "../src/data-map/expand.js";
import { parseDataMap } from "../src/data-map/parse.js";
import { parseSubprocessors } from "../src/subprocessors/parse.js";
import { convertFlatToGrouped } from "./fixtures/we-met/flat-to-grouped.js";

const fixtureDir = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/we-met",
);

function parseMap(yaml: string, filePath = "data-map.yml") {
  const result = parseDataMap(yaml, filePath);
  if ("fatal" in result) {
    throw new Error(`unexpected fatal: ${result.fatal.message}`);
  }
  return result;
}

describe("parseDataMap validation", () => {
  const base = `schema_version: 1
d1_tables:
  sessions:
    defaults:
      whose: operational
      storage: D1
      processors: [Cloudflare]
      retention: until expiry
      data: x
      purpose: y
    columns:
      id: {}
other_items: []
`;

  it("accepts a minimal valid map", () => {
    const { findings } = parseMap(base);
    expect(findings).toEqual([]);
  });

  it("reports typo hint for unknown keys", () => {
    const yaml = base.replace("retention: until expiry", "retenton: until expiry");
    const { findings } = parseMap(yaml);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe(
      "unknown key `retenton` (did you mean `retention`?)",
    );
    expect(findings[0].path).toBe("d1_tables.sessions.defaults.retenton");
  });

  it("reports duplicate other_items ids", () => {
    const yaml = `${base.replace("other_items: []", "")}other_items:
  - id: a
    whose: visitor
    data: d
    purpose: p
    processors: []
    retention: r
  - id: a
    whose: visitor
    data: d2
    purpose: p
    processors: []
    retention: r
`;
    const { findings } = parseMap(yaml);
    const dup = findings.find((f) => f.code === "duplicate_other_item_id");
    expect(dup?.message).toBe("duplicate other_items id `a`");
  });

  it("fatal on newer schema_version", () => {
    const result = parseDataMap(
      base.replace("schema_version: 1", "schema_version: 2"),
      "m.yml",
    );
    expect("fatal" in result).toBe(true);
    if ("fatal" in result) {
      expect(result.fatal.message).toBe(
        "schema_version 2 requires a newer nodrift; upgrade nodrift",
      );
    }
  });

  it("reports YAML syntax errors as fatal", () => {
    const result = parseDataMap("d1_tables: [\n  - unclosed", "m.yml");
    expect("fatal" in result).toBe(true);
    if ("fatal" in result) {
      expect(result.fatal.message).toMatch(/^YAML syntax error:/);
    }
  });

  it("reports empty file as fatal", () => {
    const result = parseDataMap("   \n", "m.yml");
    expect("fatal" in result).toBe(true);
    if ("fatal" in result) {
      expect(result.fatal.message).toBe("file is empty");
    }
  });

  it("reports missing schema_version", () => {
    const yaml = base.replace("schema_version: 1\n", "");
    const { findings } = parseMap(yaml);
    const f = findings.find((x) => x.code === "missing_schema_version");
    expect(f?.message).toBe("missing required `schema_version`");
  });

  it("reports whose TODO as classify this", () => {
    const yaml = `schema_version: 1
d1_tables:
  t:
    columns:
      c:
        whose: TODO
        data: d
        purpose: p
        processors: []
        retention: r
other_items: []
`;
    const { findings } = parseMap(yaml);
    expect(findings.some((f) => f.message === "classify this")).toBe(true);
  });

  it("rejects defaults whose on mixed personal-data table", () => {
    const yaml = `schema_version: 1
d1_tables:
  accounts:
    defaults:
      whose: operational
      processors: [Cloudflare]
    columns:
      email:
        whose: card_owner
        data: email
        purpose: sign-in
        processors: [Cloudflare]
        retention: forever
other_items: []
`;
    const { findings } = parseMap(yaml);
    expect(findings.some((f) => f.code === "defaults_whose_on_personal_table")).toBe(
      true,
    );
  });

  it("reports bare column needs whose in mixed table", () => {
    const yaml = `schema_version: 1
d1_tables:
  accounts:
    defaults:
      processors: [Cloudflare]
    columns:
      email:
        whose: card_owner
        data: email
        purpose: sign-in
        processors: [Cloudflare]
        retention: forever
      status: {}
other_items: []
`;
    const { findings } = parseMap(yaml);
    const f = findings.find((x) => x.path === "d1_tables.accounts.columns.status");
    expect(f?.message).toBe("needs `whose`");
  });

  it("reports missing required personal-data field", () => {
    const yaml = `schema_version: 1
d1_tables:
  accounts:
    columns:
      email:
        whose: card_owner
        data: email
        purpose: sign-in
        processors: [Cloudflare]
other_items: []
`;
    const { findings } = parseMap(yaml);
    expect(
      findings.some((f) => f.message === "missing required field `retention`"),
    ).toBe(true);
  });

  it("accepts processors: []", () => {
    const yaml = `schema_version: 1
d1_tables:
  browser:
    columns:
      theme:
        whose: visitor
        data: theme
        purpose: ui
        processors: []
        retention: session
other_items: []
`;
    const { findings } = parseMap(yaml);
    expect(findings).toEqual([]);
  });

  it("rejects missing processors on personal-data column", () => {
    const yaml = `schema_version: 1
d1_tables:
  browser:
    columns:
      theme:
        whose: visitor
        data: theme
        purpose: ui
        retention: session
other_items: []
`;
    const { findings } = parseMap(yaml);
    expect(
      findings.some((f) => f.message === "missing required field `processors`"),
    ).toBe(true);
  });

  it("reports invalid binding shapes on other_items", () => {
    const yaml = `schema_version: 1
d1_tables: {}
other_items:
  - id: q
    binding: []
    whose: visitor
    data: d
    purpose: p
    processors: []
    retention: r
`;
    const { findings } = parseMap(yaml);
    expect(findings.some((f) => f.code === "invalid_binding")).toBe(true);
  });

  it("reports duplicate YAML keys as fatal", () => {
    const result = parseDataMap("schema_version: 1\nschema_version: 1", "m.yml");
    expect("fatal" in result).toBe(true);
    if ("fatal" in result) {
      expect(result.fatal.message).toMatch(/^YAML syntax error:/);
    }
  });
});

describe("parseSubprocessors", () => {
  it("validates shape lightly", () => {
    const result = parseSubprocessors(
      `schema_version: 1
subprocessors:
  - name: Cloudflare
    purpose: hosting
    data: all app data
`,
      "subprocessors.yml",
    );
    if ("fatal" in result) {
      throw new Error(result.fatal.message);
    }
    expect(result.findings).toEqual([]);
    expect(result.subprocessors.subprocessors).toHaveLength(1);
  });
});

describe("we-met grouped fixture", () => {
  it("loads with zero findings and matches the flat map", () => {
    const flatYaml = readFileSync(join(fixtureDir, "data-map.flat.yml"), "utf8");
    const groupedYaml = readFileSync(join(fixtureDir, "data-map.grouped.yml"), "utf8");
    const flat = parse(flatYaml) as Array<Record<string, unknown>>;

    const parsed = parseDataMap(groupedYaml, join(fixtureDir, "data-map.grouped.yml"));
    if ("fatal" in parsed) {
      throw new Error(parsed.fatal.message);
    }
    expect(parsed.findings).toEqual([]);

    const expanded = expandDataMap(parsed.map);
    expect(expanded).toHaveLength(92);

    const byId = new Map(expanded.map((entry) => [entry.id, entry]));
    for (const row of flat) {
      const id = String(row.id);
      const entry = byId.get(id);
      expect(entry, `missing expanded entry ${id}`).toBeDefined();
      if (!entry) {
        continue;
      }

      const compare = (field: string, flatValue: unknown) => {
        if (flatValue === undefined) {
          return;
        }
        const sourced = (
          entry as unknown as Record<string, { value: unknown } | undefined>
        )[field];
        expect(sourced?.value, `${id}.${field}`).toEqual(flatValue);
      };

      compare("whose", row.whose);
      compare("storage", row.storage);
      compare("processors", row.processors);
      compare("retention", row.retention);
      compare("who_can_see", row.who_can_see);
      compare("source", row.source);
      compare("verified", row.verified);

      if (row.whose !== "operational") {
        compare("data", row.data);
        compare("purpose", row.purpose);
        compare("notes", row.notes);
      }
    }
  });

  it("converter output matches committed grouped fixture", () => {
    const flatYaml = readFileSync(join(fixtureDir, "data-map.flat.yml"), "utf8");
    const groupedYaml = readFileSync(join(fixtureDir, "data-map.grouped.yml"), "utf8");
    expect(convertFlatToGrouped(flatYaml)).toBe(groupedYaml);
  });
});
