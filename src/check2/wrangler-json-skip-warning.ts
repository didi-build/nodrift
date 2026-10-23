/** CLI warning when both JSON and JSONC exist; Wrangler uses `wrangler.json`. */
export function formatWranglerJsoncSkippedWarning(configPath: string): string {
  return `wrangler.jsonc skipped: ${configPath}`;
}
