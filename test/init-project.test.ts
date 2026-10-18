import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const initScript = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "scripts/init-project.mjs",
);

const LAUNCHPAD_MIT_SNAPSHOT = "MIT snapshot for attribution check\n";

function seedLaunchpadDir(root: string) {
  writeFileSync(
    join(root, "README.project.md"),
    "# {{PROJECT_NAME}}\n\n{{PROJECT_PURPOSE}}\n\n<!-- launchpad-attribution:start -->\n<!-- launchpad-attribution:end -->\n",
  );
  writeFileSync(
    join(root, "LICENSE.project"),
    "Copyright (c) {{PROJECT_YEAR}} {{PROJECT_OWNER}}. All rights reserved.\n",
  );
  mkdirSync(join(root, "LICENSES"), { recursive: true });
  writeFileSync(join(root, "LICENSES/launchpad-MIT.txt"), LAUNCHPAD_MIT_SNAPSHOT);
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "launchpad", launchpadTemplate: true, license: "MIT", description: "template" }, null, 2)}\n`,
  );
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/greet.ts"), "export function greet() {}\n");
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(
    join(root, "test/greet.test.ts"),
    "import { greet } from '../src/greet.js';\n",
  );
}

describe("init-project (unit)", () => {
  it("does not move templates when args are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    expect(() =>
      execFileSync("node", [initScript], { cwd: dir, encoding: "utf8" }),
    ).toThrow();
    expect(existsSync(join(dir, "README.project.md"))).toBe(true);
    expect(existsSync(join(dir, "LICENSE.project"))).toBe(true);
    expect(existsSync(join(dir, "README.md"))).toBe(false);
  });

  it("does not move templates when LICENSE.project is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    writeFileSync(
      join(dir, "README.project.md"),
      "# {{PROJECT_NAME}}\n\n{{PROJECT_PURPOSE}}\n",
    );
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ launchpadTemplate: true }, null, 2)}\n`,
    );
    expect(() =>
      execFileSync("node", [initScript, "x", "X"], { cwd: dir, encoding: "utf8" }),
    ).toThrow();
    expect(existsSync(join(dir, "README.project.md"))).toBe(true);
  });

  it("moves README and LICENSE templates on success", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    execFileSync("node", [initScript, "my-app", "My App", "Purpose", "Acme Corp"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(existsSync(join(dir, "README.project.md"))).toBe(false);
    expect(existsSync(join(dir, "LICENSE.project"))).toBe(false);
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(readme).toContain("# My App");
    expect(readme).toContain("Purpose");
    expect(readme).toContain("<!-- launchpad-attribution:start -->");
    const license = readFileSync(join(dir, "LICENSE"), "utf8");
    expect(license).toContain("Acme Corp");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.license).toBe("UNLICENSED");
    expect(pkg.description).toBe("Purpose");
    expect(pkg.launchpadTemplate).toBeUndefined();
    expect(existsSync(join(dir, "src/greet.ts"))).toBe(false);
    expect(existsSync(join(dir, "test/greet.test.ts"))).toBe(false);
    expect(existsSync(join(dir, "src/.gitkeep"))).toBe(true);
    expect(readFileSync(join(dir, "LICENSES/launchpad-MIT.txt"), "utf8")).toBe(
      LAUNCHPAD_MIT_SNAPSHOT,
    );
  });

  it("does not clobber README on re-run", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    execFileSync("node", [initScript, "my-app", "My App"], {
      cwd: dir,
      encoding: "utf8",
    });
    writeFileSync(join(dir, "README.md"), "# Custom README\n");
    expect(() =>
      execFileSync("node", [initScript, "my-app", "My App"], {
        cwd: dir,
        encoding: "utf8",
      }),
    ).toThrow();
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("# Custom README\n");
  });
});

function isLaunchpadTemplateRepo() {
  try {
    return JSON.parse(readFileSync("package.json", "utf8")).launchpadTemplate === true;
  } catch {
    return false;
  }
}

describe.skipIf(!isLaunchpadTemplateRepo())("Launchpad template license (unit)", () => {
  it("template repo is MIT-licensed", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.license).toBe("MIT");
    expect(readFileSync("LICENSE", "utf8")).toContain("Copyright (c) 2026 Didi Build");
  });
});
