import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const GITHUB_BASENAMES = ["pull_request_template.md", "PULL_REQUEST_TEMPLATE.md"];
const ROOT_BASENAMES = ["pull_request_template.md", "PULL_REQUEST_TEMPLATE.md"];
const DOCS_BASENAME = "pull_request_template.md";
const TEMPLATE_DIR = ".github/PULL_REQUEST_TEMPLATE";

function isMissingDirError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
  return false;
}

function findCaseInsensitiveBasename(
  dir: string,
  expectedNames: readonly string[],
): string | null {
  const lowered = new Set(expectedNames.map((name) => name.toLowerCase()));
  try {
    for (const name of readdirSync(dir)) {
      if (!lowered.has(name.toLowerCase())) {
        continue;
      }
      const path = join(dir, name);
      try {
        if (statSync(path).isFile()) {
          return name;
        }
      } catch {
        continue;
      }
    }
  } catch (err) {
    if (isMissingDirError(err)) {
      return null;
    }
    throw err;
  }
  return null;
}

function findTemplateFileInDirectory(dir: string): string | null {
  try {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try {
        if (statSync(path).isFile()) {
          return name;
        }
      } catch {
        continue;
      }
    }
  } catch (err) {
    if (isMissingDirError(err)) {
      return null;
    }
    throw err;
  }
  return null;
}

/**
 * Returns a repo-relative path to an existing PR template, or null.
 */
export function findExistingPrTemplate(repoRoot: string): string | null {
  const githubDir = join(repoRoot, ".github");
  const githubName = findCaseInsensitiveBasename(githubDir, GITHUB_BASENAMES);
  if (githubName) {
    return `.github/${githubName}`;
  }

  const rootName = findCaseInsensitiveBasename(repoRoot, ROOT_BASENAMES);
  if (rootName) {
    return rootName;
  }

  const docsDir = join(repoRoot, "docs");
  const docsName = findCaseInsensitiveBasename(docsDir, [DOCS_BASENAME]);
  if (docsName) {
    return `docs/${docsName}`;
  }

  const templateDir = join(repoRoot, TEMPLATE_DIR);
  const inDir = findTemplateFileInDirectory(templateDir);
  if (inDir) {
    return `${TEMPLATE_DIR}/${inDir}`;
  }

  return null;
}
