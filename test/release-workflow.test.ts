import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const workflowPath = join(root, ".github/workflows/release.yml");
const workflowText = readFileSync(workflowPath, "utf8");
const workflow = parse(workflowText) as Record<string, unknown>;

const SHA_RE = /@[0-9a-f]{40}$/;

describe("release workflow security", () => {
  it("is named release.yml and triggers only on version tags", () => {
    expect(workflowPath.endsWith("release.yml")).toBe(true);
    expect(workflow.on).toEqual({ push: { tags: ["v*"] } });
  });

  it("uses minimal permissions and OIDC for publish", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    const jobs = workflow.jobs as Record<
      string,
      { permissions?: Record<string, string>; if?: string }
    >;
    const release = jobs.release;
    expect(release.permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });
    expect(release.if).toBe("github.repository == 'didi-build/nodrift'");
  });

  it("does not reference npm tokens or GitHub secrets", () => {
    expect(workflowText).not.toMatch(/NODE_AUTH_TOKEN/);
    expect(workflowText).not.toMatch(/NPM_TOKEN/);
    expect(workflowText).not.toMatch(/secrets\./);
  });

  it("stages publish with npm stage publish (never npm publish)", () => {
    expect(workflowText).toContain("npm stage publish");
    const lines = workflowText.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("run:") && trimmed.includes("npm publish")) {
        throw new Error(`found npm publish command: ${line}`);
      }
      if (trimmed === "npm publish" || trimmed.endsWith(" npm publish")) {
        throw new Error(`found npm publish command: ${line}`);
      }
    }
  });

  it("pins actions by full SHA and uses Node 24 without cache", () => {
    const usesLines = workflowText
      .split("\n")
      .filter((line) => line.trim().startsWith("- uses:"));
    expect(usesLines.length).toBeGreaterThan(0);
    for (const line of usesLines) {
      const ref = line.trim().replace(/\s+#.*$/, "");
      expect(ref).toMatch(SHA_RE);
    }
    expect(workflowText).toContain('node-version: "24"');
    expect(workflowText).not.toContain("cache: npm");
  });

  it("runs verification, checks, and stage publish in order", () => {
    const names = workflowText
      .split("\n")
      .filter((line) => line.trim().startsWith("- name:"))
      .map((line) => line.replace(/^\s*- name:\s*/, "").trim());
    const verifyTag = names.indexOf("Verify release tag");
    const npmCi = names.indexOf("npm ci");
    const check = names.indexOf("npm run check");
    const packageCheck = names.indexOf("npm run package:check");
    const stage = names.indexOf("Stage npm release");
    expect(verifyTag).toBeGreaterThan(-1);
    expect(npmCi).toBeGreaterThan(verifyTag);
    expect(check).toBeGreaterThan(npmCi);
    expect(packageCheck).toBeGreaterThan(check);
    expect(stage).toBeGreaterThan(packageCheck);
  });
});
