import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { weMetGroupedMapWithBindingOverlay } from "./check2-overlay.js";

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const cliPath = join(packageRoot, "dist/cli.js");
const weMetFixture = join(packageRoot, "test/fixtures/we-met");

export type CliRun = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export function runCli(cwd: string, args: string[]): CliRun {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function writeWeMetProject(root: string): void {
  mkdirSync(join(root, "docs/privacy"), { recursive: true });
  const mapYaml = weMetGroupedMapWithBindingOverlay(
    join(weMetFixture, "data-map.grouped.yml"),
  );
  writeFileSync(join(root, "docs/privacy/data-map.yml"), mapYaml, "utf8");
  cpSync(join(weMetFixture, "migrations"), join(root, "migrations"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "wrangler.jsonc"),
    readFileSync(join(weMetFixture, "wrangler.jsonc"), "utf8"),
    "utf8",
  );
}
