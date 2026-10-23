import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverWranglerConfigPaths } from "../src/check2/discover-wrangler-configs.js";
import { WRANGLER_DISCOVERY_SKIP_DIRS } from "../src/check2/wrangler-skip-dirs.js";

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
  const root = mkdtempSync(join(tmpdir(), "nodrift-discover-"));
  tempRoots.push(root);
  return root;
}

describe("discoverWranglerConfigPaths", () => {
  it("uses the main missing-directory message for a missing search root", () => {
    const missing = join(makeRoot(), "no-such-wrangler-root");
    const result = discoverWranglerConfigPaths(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fatal.message).toBe(
        `Wrangler directory not found or not a directory: ${missing}; check the \`wrangler\` path`,
      );
    }
  });

  it("skips unreadable subdirectories without failing the walk", () => {
    const root = makeRoot();
    writeFileSync(join(root, "wrangler.jsonc"), "{}", "utf8");
    const blocked = join(root, "blocked");
    mkdirSync(blocked);
    writeFileSync(join(blocked, "wrangler.jsonc"), "{}", "utf8");
    chmodSync(blocked, 0o000);
    const result = discoverWranglerConfigPaths(root);
    chmodSync(blocked, 0o755);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.configPaths).toEqual([join(root, "wrangler.jsonc")]);
    }
  });

  it("fatals on a subdirectory that vanishes before the walk enters it", () => {
    const root = makeRoot();
    const vanish = join(root, "vanish");
    const result = discoverWranglerConfigPaths(root, {
      readdirSync(dir) {
        if (dir === vanish) {
          const err = new Error("gone") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return ["wrangler.jsonc", "vanish"];
      },
      lstatSync(dir) {
        if (dir === vanish) {
          return { isDirectory: () => true, isSymbolicLink: () => false };
        }
        return { isDirectory: () => false, isSymbolicLink: () => false };
      },
      realpathSync(dir) {
        return dir;
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fatal.file).toBe(vanish);
      expect(result.fatal.message).toContain("cannot read directory");
      expect(result.fatal.message).not.toContain("Wrangler directory not found");
    }
  });

  it("does not follow symlinked directories or duplicate configs via alias", () => {
    const root = makeRoot();
    const real = join(root, "real");
    mkdirSync(real);
    const configPath = join(real, "wrangler.jsonc");
    writeFileSync(configPath, "{}", "utf8");
    symlinkSync(real, join(root, "alias"), "dir");
    const loop = join(root, "loop");
    mkdirSync(loop);
    symlinkSync("..", join(loop, "up"));
    const result = discoverWranglerConfigPaths(root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.configPaths).toEqual([configPath]);
    }
  });

  it("completes quickly when a symlink points at the parent directory", () => {
    const root = makeRoot();
    writeFileSync(join(root, "wrangler.jsonc"), "{}", "utf8");
    const up = join(root, "a", "up");
    mkdirSync(join(root, "a"), { recursive: true });
    symlinkSync("..", up);
    const started = Date.now();
    const result = discoverWranglerConfigPaths(root);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.ok).toBe(true);
  });

  it.each([...WRANGLER_DISCOVERY_SKIP_DIRS])("skips the %s directory", (skipName) => {
    const root = makeRoot();
    writeFileSync(join(root, "wrangler.jsonc"), "{}", "utf8");
    const skipped = join(root, skipName, "nested");
    mkdirSync(skipped, { recursive: true });
    writeFileSync(join(skipped, "wrangler.jsonc"), "{}", "utf8");
    const result = discoverWranglerConfigPaths(root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.configPaths).toEqual([join(root, "wrangler.jsonc")]);
    }
  });
});
