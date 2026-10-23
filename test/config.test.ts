import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../src/config/parse-config.js";

describe("parseConfig", () => {
  const file = "/repo/nodrift.config.json";

  it("applies defaults for empty object", () => {
    const result = parseConfig("{}", file);
    expect(result).toEqual({ ok: true, config: { ...DEFAULT_CONFIG } });
  });

  it("overrides each key", () => {
    const text = JSON.stringify({
      map: "custom/map.yml",
      subprocessors: "custom/sub.yml",
      migrations: "sql",
      wrangler: "cf",
      wranglerConfigs: ["workers/api/wrangler.jsonc"],
      ignoreTables: ["fts_data"],
    });
    const result = parseConfig(text, file);
    expect(result).toEqual({
      ok: true,
      config: {
        map: "custom/map.yml",
        subprocessors: "custom/sub.yml",
        migrations: "sql",
        wrangler: "cf",
        wranglerConfigs: ["workers/api/wrangler.jsonc"],
        wranglerConfigsExplicit: true,
        ignoreTables: ["fts_data"],
      },
    });
  });

  it("rejects unknown keys with typo hint", () => {
    const result = parseConfig('{"maap": "x"}', file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fatal.message).toContain("did you mean `map`");
      expect(result.fatal.file).toBe(file);
    }
  });

  it("rejects wrong types", () => {
    expect(parseConfig('{"map": 1}', file).ok).toBe(false);
    expect(parseConfig('{"ignoreTables": "x"}', file).ok).toBe(false);
  });

  it("rejects empty strings", () => {
    expect(parseConfig('{"map": ""}', file).ok).toBe(false);
    expect(parseConfig('{"ignoreTables": [""]}', file).ok).toBe(false);
  });

  it("rejects invalid JSON", () => {
    const result = parseConfig("{", file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fatal.message).toContain("invalid JSON");
    }
  });

  it("rejects non-object root", () => {
    expect(parseConfig("[]", file).ok).toBe(false);
    expect(parseConfig("null", file).ok).toBe(false);
  });

  it("accepts JSON with a leading UTF-8 BOM", () => {
    const result = parseConfig("\uFEFF{}", file);
    expect(result).toEqual({ ok: true, config: { ...DEFAULT_CONFIG } });
  });
});
