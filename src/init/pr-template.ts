import { existsSync } from "node:fs";
import { join } from "node:path";

const PR_TEMPLATE_CANDIDATES = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  "pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
];

const PR_TEMPLATE_DIR = ".github/PULL_REQUEST_TEMPLATE";

export function findExistingPrTemplate(repoRoot: string): string | null {
  for (const relative of PR_TEMPLATE_CANDIDATES) {
    const path = join(repoRoot, relative);
    if (existsSync(path)) {
      return relative;
    }
  }
  const dirPath = join(repoRoot, PR_TEMPLATE_DIR);
  if (existsSync(dirPath)) {
    return PR_TEMPLATE_DIR;
  }
  return null;
}
