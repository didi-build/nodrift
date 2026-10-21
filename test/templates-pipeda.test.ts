import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const templatesDir = join(packageRoot, "templates");

const SKELETON_FOOTER =
  "_This document is a starting skeleton, not legal advice. Review it with qualified counsel before relying on it._";

const MARKDOWN_SKELETONS = [
  "breach-response.md",
  "breach-record-template.md",
  "account-deletion.md",
  "SECURITY.md",
] as const;

function readTemplate(name: string): string {
  return readFileSync(join(templatesDir, name), "utf8");
}

function breachRunbookSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const chunks = markdown.split(/^## /m).slice(1);
  for (const chunk of chunks) {
    const newline = chunk.indexOf("\n");
    const title = newline === -1 ? chunk.trim() : chunk.slice(0, newline).trim();
    const body = newline === -1 ? "" : chunk.slice(newline + 1);
    sections.set(title, body);
  }
  return sections;
}

describe("PIPEDA package templates", () => {
  it("ends every Markdown skeleton with the not-legal-advice footer", () => {
    for (const name of MARKDOWN_SKELETONS) {
      const text = readTemplate(name);
      expect(text.trimEnd().endsWith(SKELETON_FOOTER)).toBe(true);
    }
  });

  it("states the 24-month breach-record retention rule", () => {
    const record = readTemplate("breach-record-template.md");
    expect(record).toContain("**Keep until:** 24 months after the determination date");
  });

  it("pins OPC and Regulations citations in the breach runbook", () => {
    const breach = readTemplate("breach-response.md");
    const sections = breachRunbookSections(breach);

    const assess = sections.get("2. Assess real risk of significant harm");
    expect(assess).toContain("Part 6");

    const report = sections.get("3. Report to the Privacy Commissioner of Canada");
    expect(report).toBeDefined();
    expect(report).toContain("PIPEDA s. 10.1(2)");
    expect(report).toContain("Parts 1 and 2");
    expect(report).toContain("s. 2");
    expect(report).not.toMatch(/OPC guidance, Part 3/);
    expect(report).not.toContain("Regulations, s. 4");
    expect(report).not.toMatch(/OPC guidance \(Part 3\)/);
    expect(breach).toContain(
      "[What you need to know about mandatory reporting of breaches of security safeguards]",
    );

    const notifyIndividuals = sections.get("4. Notify affected individuals");
    expect(notifyIndividuals).toContain("Part 4");
    expect(notifyIndividuals).toContain("s. 5(1)");

    const notifyOthers = sections.get("5. Notify other organizations");
    expect(notifyOthers).toContain("Part 5");
    expect(notifyOthers).toContain("must also notify");

    const records = sections.get("6. Keep breach records");
    expect(records).toContain("s. 6(1)");

    expect(breach).not.toContain("prohibits direct notification");
    expect(breach).toContain(
      "https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/privacy-breaches-at-your-business/gd_pb_201810/",
    );
    expect(breach).toContain(
      "https://www.priv.gc.ca/en/report-a-concern/report-a-privacy-breach-at-your-organization/report-a-privacy-breach-at-your-business/",
    );
  });
});
