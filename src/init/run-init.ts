import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ResolvedNodriftConfig } from "../config/load-config.js";
import { fatal, type FatalError } from "../findings.js";
import {
  buildManifest,
  contentSha256,
  mergeManifestEntries,
  parseManifestJson,
  type ManifestFileEntry,
} from "./manifest.js";
import { kitVersionFromModule, readPackageTemplate } from "./package-paths.js";
import { assertAncestorDirectories, statPath } from "./path-state.js";
import { findExistingPrTemplate } from "./pr-template.js";
import { scaffoldDataMapYaml } from "./scaffold-map.js";

const INIT_MODULE_URL = import.meta.url;
const MANIFEST_REL = ".nodrift/manifest.json";

export type InitPlanItem =
  | { action: "create"; relativePath: string; content: string }
  | { action: "skip"; relativePath: string }
  | { action: "write-manifest"; content: string };

export type InitPlanResult =
  | {
      ok: true;
      items: InitPlanItem[];
      privacyChecklistBlock: string | null;
      privacyChecklistTargetPath: string | null;
    }
  | { ok: false; fatal: FatalError };

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

function loadExistingManifest(
  manifestPath: string,
): { ok: true; manifest: ManifestFileEntry[] } | { ok: false; fatal: FatalError } {
  const stat = statPath(manifestPath);
  if (stat.kind === "missing") {
    return { ok: true, manifest: [] };
  }
  if (stat.kind === "error") {
    return { ok: false, fatal: stat.fatal };
  }
  if (stat.kind === "directory") {
    return {
      ok: false,
      fatal: fatal(manifestPath, "manifest path is not a file"),
    };
  }

  try {
    const text = readFileSync(manifestPath, "utf8");
    const parsed = parseManifestJson(text, manifestPath);
    if (!parsed.ok) {
      return parsed;
    }
    return { ok: true, manifest: parsed.manifest?.files ?? [] };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      fatal: fatal(manifestPath, `cannot read manifest: ${detail}`),
    };
  }
}

function planOwnedFile(
  repoRoot: string,
  absolutePath: string,
  template: string,
  items: InitPlanItem[],
): FatalError | null {
  const ancestorError = assertAncestorDirectories(repoRoot, absolutePath);
  if (ancestorError) {
    return ancestorError;
  }

  const rel = repoRelative(repoRoot, absolutePath);
  const stat = statPath(absolutePath);
  if (stat.kind === "error") {
    return stat.fatal;
  }
  if (stat.kind === "file") {
    items.push({ action: "skip", relativePath: rel });
    return null;
  }
  if (stat.kind === "directory") {
    return fatal(absolutePath, "path exists but is not a file");
  }

  items.push({
    action: "create",
    relativePath: rel,
    content: normalizeLf(template),
  });
  return null;
}

export function planInit(
  repoRoot: string,
  config: ResolvedNodriftConfig,
): InitPlanResult {
  const manifestPath = join(repoRoot, MANIFEST_REL);
  const existingManifest = loadExistingManifest(manifestPath);
  if (!existingManifest.ok) {
    return existingManifest;
  }

  const items: InitPlanItem[] = [];
  const kitVersion = kitVersionFromModule(INIT_MODULE_URL);

  const mapScaffold = scaffoldDataMapYaml(
    config.migrationsDir,
    config.mapPath,
    config.ignoreTables,
  );
  if (!mapScaffold.ok) {
    return mapScaffold;
  }

  const ownedTargets: Array<{ absolutePath: string; template: string }> = [
    { absolutePath: config.mapPath, template: mapScaffold.yaml },
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

  for (const target of ownedTargets) {
    const err = planOwnedFile(repoRoot, target.absolutePath, target.template, items);
    if (err) {
      return { ok: false, fatal: err };
    }
  }

  let privacyChecklistBlock: string | null = null;
  let privacyChecklistTargetPath: string | null = null;
  const existingPr = findExistingPrTemplate(repoRoot);
  if (existingPr) {
    items.push({ action: "skip", relativePath: existingPr });
    privacyChecklistTargetPath = existingPr;
    privacyChecklistBlock = readPackageTemplate(
      INIT_MODULE_URL,
      "privacy-checklist-block.txt",
    );
  } else {
    const prErr = planOwnedFile(
      repoRoot,
      join(repoRoot, ".github/pull_request_template.md"),
      readPackageTemplate(INIT_MODULE_URL, "pull_request_template.md"),
      items,
    );
    if (prErr) {
      return { ok: false, fatal: prErr };
    }
  }

  const creates = items.filter(
    (item): item is Extract<InitPlanItem, { action: "create" }> =>
      item.action === "create",
  );

  if (creates.length > 0) {
    const newEntries: ManifestFileEntry[] = creates.map((item) => ({
      path: item.relativePath,
      kind: "owned",
      version: kitVersion,
      sha256: contentSha256(item.content),
    }));
    const merged = mergeManifestEntries(existingManifest.manifest, newEntries);
    const manifestJson = `${JSON.stringify(buildManifest(merged), null, 2)}\n`;
    items.push({ action: "write-manifest", content: manifestJson });
  }

  return { ok: true, items, privacyChecklistBlock, privacyChecklistTargetPath };
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
      lines: [
        `${planned.fatal.file}: ${planned.fatal.message}`,
        "nodrift init: failed",
      ],
    };
  }

  const lines: string[] = [];
  const written: string[] = [];
  const manifestPath = join(repoRoot, MANIFEST_REL);
  const manifestExisted = statPath(manifestPath).kind === "file";

  for (const item of planned.items) {
    if (item.action === "skip") {
      lines.push(
        dryRun
          ? `would skip ${item.relativePath} (exists)`
          : `skipped ${item.relativePath} (exists)`,
      );
      continue;
    }

    if (item.action === "write-manifest") {
      if (dryRun) {
        lines.push(
          manifestExisted
            ? `would update ${MANIFEST_REL}`
            : `would create ${MANIFEST_REL}`,
        );
        continue;
      }
      try {
        const dir = dirname(manifestPath);
        mkdirSync(dir, { recursive: true });
        if (manifestExisted) {
          writeFileSync(manifestPath, item.content, "utf8");
        } else {
          writeFileSync(manifestPath, item.content, { encoding: "utf8", flag: "wx" });
        }
        written.push(MANIFEST_REL);
        lines.push(
          manifestExisted ? `updated ${MANIFEST_REL}` : `created ${MANIFEST_REL}`,
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (written.length > 0) {
          lines.push(`wrote ${written.join(", ")} before failure`);
        }
        lines.push(`failed to create ${MANIFEST_REL}: ${detail}`);
        lines.push("nodrift init: failed");
        return { exitCode: 2, lines };
      }
      continue;
    }

    if (dryRun) {
      lines.push(`would create ${item.relativePath}`);
      continue;
    }

    const absolute = join(repoRoot, item.relativePath);
    try {
      writeExclusive(absolute, item.content);
      written.push(item.relativePath);
      lines.push(`created ${item.relativePath}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (written.length > 0) {
        lines.push(`wrote ${written.join(", ")} before failure`);
      }
      lines.push(`failed to create ${item.relativePath}: ${detail}`);
      lines.push("nodrift init: failed");
      return { exitCode: 2, lines };
    }
  }

  if (planned.privacyChecklistBlock && planned.privacyChecklistTargetPath) {
    lines.push(
      `paste this privacy checklist into ${planned.privacyChecklistTargetPath}:`,
    );
    lines.push(planned.privacyChecklistBlock.trimEnd());
  }

  lines.push(dryRun ? "nodrift init: dry run" : "nodrift init: ok");
  return { exitCode: 0, lines };
}
