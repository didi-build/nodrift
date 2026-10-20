import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ResolvedNodriftConfig } from "../config/load-config.js";
import { contentSha256, type ManifestFileEntry, buildManifest } from "./manifest.js";
import { kitVersionFromModule, readPackageTemplate } from "./package-paths.js";
import { findExistingPrTemplate } from "./pr-template.js";
import { scaffoldDataMapYaml } from "./scaffold-map.js";

const INIT_MODULE_URL = import.meta.url;

export type InitPlanItem =
  | { action: "create"; relativePath: string; content: string }
  | { action: "skip"; relativePath: string; reason: string };

export type InitPlanResult =
  | { ok: true; items: InitPlanItem[]; privacyChecklistBlock: string | null }
  | { ok: false; message: string };

export type InitApplyResult = {
  exitCode: number;
  lines: string[];
};

function normalizeLf(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function repoRelative(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).split("\\").join("/");
}

export function planInit(
  repoRoot: string,
  config: ResolvedNodriftConfig,
): InitPlanResult {
  const items: InitPlanItem[] = [];
  const kitVersion = kitVersionFromModule(INIT_MODULE_URL);

  const mapScaffold = scaffoldDataMapYaml(config.migrationsDir, config.mapPath);
  if (!mapScaffold.ok) {
    return { ok: false, message: mapScaffold.fatal.message };
  }

  const staticFiles: Array<{ absolutePath: string; template: string }> = [
    {
      absolutePath: config.mapPath,
      template: mapScaffold.yaml,
    },
    {
      absolutePath: config.subprocessorsPath,
      template: readPackageTemplate(INIT_MODULE_URL, "subprocessors.yml"),
    },
    {
      absolutePath: join(repoRoot, "docs/runbooks/breach-response.md"),
      template: readPackageTemplate(INIT_MODULE_URL, "breach-response.md"),
    },
    {
      absolutePath: join(repoRoot, "docs/privacy/breach-record-template.md"),
      template: readPackageTemplate(INIT_MODULE_URL, "breach-record-template.md"),
    },
    {
      absolutePath: join(repoRoot, "docs/runbooks/account-deletion.md"),
      template: readPackageTemplate(INIT_MODULE_URL, "account-deletion.md"),
    },
    {
      absolutePath: join(repoRoot, "SECURITY.md"),
      template: readPackageTemplate(INIT_MODULE_URL, "SECURITY.md"),
    },
  ];

  for (const file of staticFiles) {
    const rel = repoRelative(repoRoot, file.absolutePath);
    if (existsSync(file.absolutePath)) {
      items.push({ action: "skip", relativePath: rel, reason: "already exists" });
    } else {
      items.push({
        action: "create",
        relativePath: rel,
        content: normalizeLf(file.template),
      });
    }
  }

  const existingPr = findExistingPrTemplate(repoRoot);
  let privacyChecklistBlock: string | null = null;
  const prPath = join(repoRoot, ".github/pull_request_template.md");
  if (existingPr) {
    items.push({
      action: "skip",
      relativePath: existingPr,
      reason: "PR template already present",
    });
    privacyChecklistBlock = readPackageTemplate(
      INIT_MODULE_URL,
      "privacy-checklist-block.txt",
    );
  } else if (existsSync(prPath)) {
    items.push({
      action: "skip",
      relativePath: ".github/pull_request_template.md",
      reason: "already exists",
    });
  } else {
    items.push({
      action: "create",
      relativePath: ".github/pull_request_template.md",
      content: normalizeLf(
        readPackageTemplate(INIT_MODULE_URL, "pull_request_template.md"),
      ),
    });
  }

  const manifestPath = join(repoRoot, ".nodrift/manifest.json");
  const manifestRel = ".nodrift/manifest.json";
  if (existsSync(manifestPath)) {
    items.push({ action: "skip", relativePath: manifestRel, reason: "already exists" });
  } else {
    const creates = items.filter(
      (item): item is Extract<InitPlanItem, { action: "create" }> =>
        item.action === "create",
    );
    const manifestEntries: ManifestFileEntry[] = creates.map((item) => ({
      path: item.relativePath,
      kind: "owned",
      kitVersion,
      sha256: contentSha256(item.content),
    }));
    const manifestJson = `${JSON.stringify(buildManifest(kitVersion, manifestEntries), null, 2)}\n`;
    items.push({
      action: "create",
      relativePath: manifestRel,
      content: manifestJson,
    });
  }

  return { ok: true, items, privacyChecklistBlock };
}

function writeExclusive(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
}

export function runInit(
  repoRoot: string,
  config: ResolvedNodriftConfig,
  dryRun: boolean,
): InitApplyResult {
  const planned = planInit(repoRoot, config);
  if (!planned.ok) {
    return {
      exitCode: 2,
      lines: [`nodrift init: ${planned.message}`],
    };
  }

  const lines: string[] = [];
  const written: string[] = [];

  for (const item of planned.items) {
    if (item.action === "skip") {
      lines.push(`nodrift init: skipped ${item.relativePath} (${item.reason})`);
      continue;
    }

    if (dryRun) {
      lines.push(`nodrift init: would create ${item.relativePath}`);
      continue;
    }

    const absolute = join(repoRoot, item.relativePath);
    try {
      writeExclusive(absolute, item.content);
      written.push(item.relativePath);
      lines.push(`nodrift init: created ${item.relativePath}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (written.length > 0) {
        lines.push(`nodrift init: wrote ${written.join(", ")} before failure`);
      }
      lines.push(`nodrift init: failed to create ${item.relativePath}: ${detail}`);
      return { exitCode: 2, lines };
    }
  }

  if (planned.privacyChecklistBlock) {
    lines.push("nodrift init: paste this privacy checklist into your PR template:");
    lines.push(planned.privacyChecklistBlock);
  }

  if (dryRun) {
    lines.push("nodrift init: dry run (no files written)");
  } else {
    lines.push("nodrift init: done");
  }

  return { exitCode: 0, lines };
}
