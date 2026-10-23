/** CLI warning when discovery sees a `wrangler.toml` (JSON/JSONC only in v1). */
export function formatWranglerTomlSkippedWarning(configPath: string): string {
  return `wrangler.toml is unsupported, skipped: ${configPath}`;
}
