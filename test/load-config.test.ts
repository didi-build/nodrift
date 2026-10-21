import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load-config.js";

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("loadConfig path resolution", () => {
  it("preserves absolute paths from the config file", () => {
    const root = mkdtempSync(join(tmpdir(), "nodrift-config-"));
    tempRoots.push(root);
    const absMap = join(root, "abs-map.yml");
    writeFileSync(
      join(root, "nodrift.config.json"),
      JSON.stringify({ map: absMap }),
      "utf8",
    );
    const loaded = loadConfig(root);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.config.mapPath).toBe(absMap);
    }
  });
});
