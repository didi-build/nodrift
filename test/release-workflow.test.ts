import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const workflowPath = join(root, ".github/workflows/release.yml");
const workflowText = readFileSync(workflowPath, "utf8");
const workflow = parse(workflowText) as Record<string, unknown>;

const USES_SHA_RE = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};

function releaseSteps(): WorkflowStep[] {
  const jobs = workflow.jobs as Record<string, { steps: WorkflowStep[] }>;
  return jobs.release.steps;
}

function stepNamed(steps: WorkflowStep[], name: string): WorkflowStep | undefined {
  return steps.find((step) => step.name === name);
}

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

  it("defines only the release job", () => {
    expect(Object.keys(workflow.jobs as object)).toEqual(["release"]);
  });

  it("does not reference npm tokens or GitHub secrets", () => {
    expect(workflowText).not.toMatch(/NODE_AUTH_TOKEN/);
    expect(workflowText).not.toMatch(/NPM_TOKEN/);
    expect(workflowText).not.toMatch(/secrets\./);
  });

  it("pins every uses: step by full commit SHA (any key order)", () => {
    const steps = releaseSteps();
    const withUses = steps.filter((step) => step.uses !== undefined);
    expect(withUses.length).toBeGreaterThan(0);
    for (const step of withUses) {
      expect(step.uses).toMatch(USES_SHA_RE);
    }
  });

  it("configures checkout and setup-node from parsed steps", () => {
    const steps = releaseSteps();
    const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.["fetch-depth"]).toBe(0);

    const setupNode = steps.find((step) =>
      step.uses?.startsWith("actions/setup-node@"),
    );
    expect(setupNode?.with?.["node-version"]).toBe("24");
    expect(setupNode?.with?.["registry-url"]).toBe("https://registry.npmjs.org");
    expect(setupNode?.with).not.toHaveProperty("cache");
  });

  it("requires npm 11.15+ before npm ci", () => {
    const steps = releaseSteps();
    const ensureNpm = stepNamed(steps, "Ensure npm supports staged publishing");
    const npmCi = stepNamed(steps, "npm ci");
    expect(ensureNpm).toBeDefined();
    expect(npmCi).toBeDefined();
    expect(steps.indexOf(ensureNpm!)).toBeLessThan(steps.indexOf(npmCi!));
    expect(ensureNpm!.run).toContain("npm@^11.15.0");
    expect(ensureNpm!.run).toMatch(/exit\s+1/);
  });

  it("verifies tag name, package version, and main ancestry", () => {
    const verify = stepNamed(releaseSteps(), "Verify release tag");
    expect(verify?.run).toContain("GITHUB_REF_NAME");
    expect(verify?.run).toContain("package.json");
    expect(verify?.run).toContain('!= "v${version}"');
    expect(verify?.run).toContain(
      'git merge-base --is-ancestor "${GITHUB_SHA}" origin/main',
    );
    expect(verify?.run).toContain("git fetch origin main");
  });

  it("never runs npm publish; stage step is exact", () => {
    const steps = releaseSteps();
    for (const step of steps) {
      if (step.run) {
        expect(step.run).not.toMatch(/\bnpm\s+publish\b/);
      }
    }
    const stage = stepNamed(steps, "Stage npm release");
    expect(stage?.run?.trim()).toBe("npm stage publish");
  });

  it("runs verification, checks, and stage publish in order", () => {
    const names = releaseSteps()
      .map((step) => step.name)
      .filter((name): name is string => name !== undefined);
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
