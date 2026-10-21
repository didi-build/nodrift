import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function getPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const packagePath = join(here, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version: string };
  return pkg.version;
}

export const USAGE = `Usage: nodrift <command> [options]

Commands:
  check   Run privacy drift checks
  init    Scaffold owned privacy docs (idempotent)
  sync    Reserved for v2 (not available in v1)

Options:
  -h, --help       Show this help
  -v, --version    Show package version
  --config <path>  Path to nodrift.config.json (relative to repo root)
  --dry-run        Preview init changes (init only)
`;

export function printUsageHint(stream: NodeJS.WriteStream): void {
  stream.write("Run nodrift --help for usage.\n");
}
