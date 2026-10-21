import { describe, expect, it } from "vitest";
import { isAllowedPackagePath } from "../scripts/check-package.mjs";

describe("check-package allowlist", () => {
  it("accepts required package paths", () => {
    expect(isAllowedPackagePath("package.json")).toBe(true);
    expect(isAllowedPackagePath("LICENSE")).toBe(true);
    expect(isAllowedPackagePath("README.md")).toBe(true);
    expect(isAllowedPackagePath("LICENSES/launchpad-MIT.txt")).toBe(true);
    expect(isAllowedPackagePath("templates/breach-response.md")).toBe(true);
    expect(isAllowedPackagePath("dist/cli.js")).toBe(true);
    expect(isAllowedPackagePath("dist/init/run-init.js")).toBe(true);
  });

  it("rejects paths outside the allowlist", () => {
    expect(isAllowedPackagePath("src/cli.ts")).toBe(false);
    expect(isAllowedPackagePath("dist/cli.d.ts")).toBe(false);
    expect(isAllowedPackagePath("dist/cli.js.map")).toBe(false);
    expect(isAllowedPackagePath(".env.example")).toBe(false);
    expect(isAllowedPackagePath("AGENTS.md")).toBe(false);
    expect(isAllowedPackagePath("templates/../AGENTS.md")).toBe(false);
  });
});
