/** CLI warning when discovery cannot read a nested directory (search root stays fatal). */
export function formatUnreadableDirSkippedWarning(dirPath: string): string {
  return `cannot read directory, skipped: ${dirPath}`;
}
