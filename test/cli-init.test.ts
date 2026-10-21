import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentSha256 } from "../src/init/manifest.js";
import { findExistingPrTemplate } from "../src/init/pr-template.js";
import { runCli, writeWeMetProject } from "./cli-helpers.js";

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
  const root = mkdtempSync(join(tmpdir(), "nodrift-init-"));
  tempRoots.push(root);
  return root;
}

function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out.sort();
}

const EMPTY_MAP = "schema_version: 1\nd1_tables: {}\nother_items: []\n";

describe("nodrift init CLI", () => {
  it("creates owned scaffolds on an empty project", () => {
    const root = tempRoot();
    const result = runCli(root, ["init"]);
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, "docs/privacy/data-map.yml"), "utf8")).toBe(
      EMPTY_MAP,
    );
    expect(result.stdout).toContain("nodrift init: ok");
  });

  it("dry-run writes nothing and uses would-create / would-skip lines", () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs/privacy"), { recursive: true });
    writeFileSync(join(root, "docs/privacy/data-map.yml"), EMPTY_MAP, "utf8");
    const before = listFilesRecursive(root);
    const result = runCli(root, ["init", "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("would skip docs/privacy/data-map.yml (exists)");
    expect(result.stdout).toContain("would create");
    expect(result.stdout).toContain("nodrift init: dry run");
    expect(existsSync(join(root, ".nodrift/manifest.json"))).toBe(false);
    expect(listFilesRecursive(root)).toEqual(before);
  });

  it("dry-run on an empty project leaves the file tree unchanged", () => {
    const root = tempRoot();
    const before = listFilesRecursive(root);
    runCli(root, ["init", "--dry-run"]);
    expect(listFilesRecursive(root)).toEqual(before);
  });

  it("skips existing files on a second run", () => {
    const root = tempRoot();
    expect(runCli(root, ["init"]).status).toBe(0);
    const second = runCli(root, ["init"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("skipped docs/privacy/data-map.yml (exists)");
  });

  it("does not overwrite an existing owned file", () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs/privacy"), { recursive: true });
    writeFileSync(join(root, "SECURITY.md"), "KEEP\n", "utf8");
    runCli(root, ["init"]);
    expect(readFileSync(join(root, "SECURITY.md"), "utf8")).toBe("KEEP\n");
  });

  it("scaffolds columns with whose TODO only", () => {
    const root = tempRoot();
    writeWeMetProject(root);
    rmSync(join(root, "docs/privacy/data-map.yml"));
    runCli(root, ["init"]);
    const map = readFileSync(join(root, "docs/privacy/data-map.yml"), "utf8");
    expect(map).toContain("whose: TODO");
    expect(map).not.toMatch(/data:\s*TODO/);
    expect(map).not.toContain("who_can_see:");
  });

  it("honors ignoreTables when scaffolding from migrations", () => {
    const root = tempRoot();
    mkdirSync(join(root, "migrations"), { recursive: true });
    writeFileSync(
      join(root, "migrations/001.sql"),
      "CREATE TABLE visible (id TEXT); CREATE TABLE hidden_t (id TEXT);\n",
      "utf8",
    );
    writeFileSync(
      join(root, "nodrift.config.json"),
      JSON.stringify({ ignoreTables: ["hidden_t"] }),
      "utf8",
    );
    runCli(root, ["init"]);
    const map = readFileSync(join(root, "docs/privacy/data-map.yml"), "utf8");
    expect(map).toContain("visible:");
    expect(map).not.toContain("hidden_t:");
  });

  it("each manifest hash equals the SHA-256 of the written file", () => {
    const root = tempRoot();
    runCli(root, ["init"]);
    const manifest = JSON.parse(
      readFileSync(join(root, ".nodrift/manifest.json"), "utf8"),
    ) as {
      schemaVersion: number;
      files: Array<{ path: string; sha256: string }>;
    };
    expect(manifest.schemaVersion).toBe(1);
    for (const entry of manifest.files) {
      if (entry.path === ".nodrift/manifest.json") {
        continue;
      }
      const bytes = readFileSync(join(root, entry.path), "utf8");
      expect(entry.sha256).toBe(contentSha256(bytes));
      expect(entry.sha256).toBe(
        createHash("sha256").update(bytes, "utf8").digest("hex"),
      );
    }
  });

  it("merges manifest when re-creating a deleted owned file", () => {
    const root = tempRoot();
    runCli(root, ["init"]);
    const beforeManifest = JSON.parse(
      readFileSync(join(root, ".nodrift/manifest.json"), "utf8"),
    ) as { files: Array<{ path: string; sha256: string }> };
    const beforeByPath = new Map(
      beforeManifest.files.map((entry) => [entry.path, entry.sha256]),
    );
    rmSync(join(root, "SECURITY.md"));
    const second = runCli(root, ["init"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("updated .nodrift/manifest.json");
    expect(existsSync(join(root, "SECURITY.md"))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(root, ".nodrift/manifest.json"), "utf8"),
    ) as { files: Array<{ path: string; sha256: string }> };
    for (const entry of manifest.files) {
      if (entry.path === "SECURITY.md") {
        expect(entry.sha256).toBe(
          contentSha256(readFileSync(join(root, "SECURITY.md"), "utf8")),
        );
        continue;
      }
      expect(entry.sha256).toBe(beforeByPath.get(entry.path));
    }
    expect(manifest.files.length).toBe(beforeManifest.files.length);
  });

  it("does not write a manifest when every owned file already exists and manifest is missing", () => {
    const root = tempRoot();
    runCli(root, ["init"]);
    rmSync(join(root, ".nodrift/manifest.json"));
    rmSync(join(root, ".nodrift"), { recursive: true, force: true });
    const second = runCli(root, ["init"]);
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain("created .nodrift/manifest.json");
    expect(second.stdout).not.toContain("updated .nodrift/manifest.json");
    expect(existsSync(join(root, ".nodrift/manifest.json"))).toBe(false);
  });

  it("exits 2 on corrupt manifest before writing anything", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".nodrift"), { recursive: true });
    writeFileSync(join(root, ".nodrift/manifest.json"), "{bad json", "utf8");
    const result = runCli(root, ["init"]);
    expect(result.status).toBe(2);
    expect(existsSync(join(root, "docs/privacy/data-map.yml"))).toBe(false);
  });

  it("exits 2 on unsupported manifest schemaVersion before writing", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".nodrift"), { recursive: true });
    writeFileSync(
      join(root, ".nodrift/manifest.json"),
      JSON.stringify({ schemaVersion: 99, files: [] }),
      "utf8",
    );
    const result = runCli(root, ["init"]);
    expect(result.status).toBe(2);
    expect(existsSync(join(root, "SECURITY.md"))).toBe(false);
  });

  it("exits 2 when a parent path is a file and writes nothing", () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs/runbooks"), "not a directory\n", "utf8");
    const result = runCli(root, ["init"]);
    expect(result.status).toBe(2);
    expect(existsSync(join(root, "docs/privacy/data-map.yml"))).toBe(false);
  });

  it("prints the privacy checklist block when a PR template exists", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".github"), { recursive: true });
    writeFileSync(
      join(root, ".github/pull_request_template.md"),
      "# existing\n",
      "utf8",
    );
    const result = runCli(root, ["init"]);
    expect(result.stdout).toContain(
      "paste this privacy checklist into .github/pull_request_template.md:",
    );
    expect(result.stdout).toContain("## Privacy checklist");
    expect(result.stdout).toContain(
      "The privacy page and the runbooks still match what the code does",
    );
  });

  it("detects PR templates case-insensitively", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".github"), { recursive: true });
    writeFileSync(join(root, ".github/Pull_Request_Template.md"), "# t\n", "utf8");
    expect(findExistingPrTemplate(root)).toBe(".github/Pull_Request_Template.md");
    const result = runCli(root, ["init"]);
    expect(result.stdout).not.toContain("created .github/pull_request_template.md");
  });

  it("detects docs/pull_request_template.md", () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs/pull_request_template.md"), "# t\n", "utf8");
    expect(findExistingPrTemplate(root)).toBe("docs/pull_request_template.md");
  });

  it("detects a file inside .github/PULL_REQUEST_TEMPLATE", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".github/PULL_REQUEST_TEMPLATE"), { recursive: true });
    writeFileSync(
      join(root, ".github/PULL_REQUEST_TEMPLATE/feature.md"),
      "# t\n",
      "utf8",
    );
    expect(findExistingPrTemplate(root)).toBe(
      ".github/PULL_REQUEST_TEMPLATE/feature.md",
    );
  });

  it("ignores an empty .github/PULL_REQUEST_TEMPLATE directory", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".github/PULL_REQUEST_TEMPLATE"), { recursive: true });
    expect(findExistingPrTemplate(root)).toBeNull();
    runCli(root, ["init"]);
    expect(existsSync(join(root, ".github/pull_request_template.md"))).toBe(true);
  });

  it("exits 2 when migrations fail during planning", () => {
    const root = tempRoot();
    mkdirSync(join(root, "migrations"), { recursive: true });
    writeFileSync(join(root, "migrations/001_bad.sql"), "NOT SQL;\n", "utf8");
    const result = runCli(root, ["init"]);
    expect(result.status).toBe(2);
    expect(existsSync(join(root, "docs/privacy/data-map.yml"))).toBe(false);
  });

  it("includes PIPEDA breach-response facts and skeleton note in templates", () => {
    const root = tempRoot();
    runCli(root, ["init"]);
    const breach = readFileSync(join(root, "docs/runbooks/breach-response.md"), "utf8");
    expect(breach).toContain("24 months");
    expect(breach).toContain("real risk of significant harm");
    expect(breach).toContain("gazette.gc.ca");
    expect(breach).toContain("not legal advice");
    expect(breach).toContain("Unless otherwise prohibited by law");
    expect(breach).toContain(
      "Indirect notification is permitted only when direct notification",
    );
    expect(breach).toContain("s. 5(1)");
    expect(breach).toContain("s. 5(2)");
    expect(breach).toContain(
      "notify any government institutions or organizations that you believe can reduce the risk of harm",
    );
    expect(breach).toContain("organization that processes your payments");
    expect(breach).not.toContain("prohibits direct notification");
    expect(breach).toContain(
      "https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/privacy-breaches-at-your-business/gd_pb_201810/",
    );
    expect(breach).toContain(
      "https://www.priv.gc.ca/en/report-a-concern/report-a-privacy-breach-at-your-organization/report-a-privacy-breach-at-your-business/",
    );
    const record = readFileSync(
      join(root, "docs/privacy/breach-record-template.md"),
      "utf8",
    );
    expect(record).toContain("**Date or estimated date the breach occurred (UTC):**");
    const security = readFileSync(join(root, "SECURITY.md"), "utf8");
    expect(security).toContain("TODO: contact email");
    expect(security).not.toContain("security@example.com");
  });
});
