/** Directory names skipped when discovering Wrangler config files (vendored, build, VCS). */
export const WRANGLER_DISCOVERY_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  "test-results",
  ".git",
  ".next",
  ".open-next",
  ".cache",
  ".turbo",
  ".vercel",
  ".husky",
  ".nodrift",
]);
