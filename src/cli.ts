#!/usr/bin/env node
import { loadConfig } from "./config/load-config.js";
import { formatFatal } from "./cli/format-output.js";
import { parseCli } from "./cli/parse-cli.js";
import { runCheck } from "./cli/run-check.js";
import { writeStderr, writeStdout } from "./cli/stdio.js";
import { getPackageVersion, printUsageHint, USAGE } from "./cli/usage.js";
import { runInit } from "./init/run-init.js";

async function main(): Promise<void> {
  const parsed = parseCli(process.argv.slice(2));
  if (!parsed.ok) {
    printUsageHint(process.stderr);
    process.exitCode = 2;
    return;
  }

  if (parsed.help) {
    await writeStdout(USAGE);
    process.exitCode = 0;
    return;
  }

  if (parsed.version) {
    await writeStdout(`${getPackageVersion()}\n`);
    process.exitCode = 0;
    return;
  }

  if (parsed.command === "sync") {
    await writeStderr("nodrift sync is not available in v1\n");
    process.exitCode = 2;
    return;
  }

  const loaded = loadConfig(process.cwd(), parsed.configPath);
  if (!loaded.ok) {
    await writeStderr(`${formatFatal(loaded.fatal)}\n`);
    process.exitCode = 2;
    return;
  }

  if (parsed.command === "check") {
    const result = runCheck(loaded.config);
    await writeStdout(`${result.lines.join("\n")}\n`);
    process.exitCode = result.exitCode;
    return;
  }

  const result = runInit(process.cwd(), loaded.config, parsed.dryRun);
  await writeStdout(`${result.lines.join("\n")}\n`);
  process.exitCode = result.exitCode;
}

void main().catch(async (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  await writeStderr(`nodrift: unexpected error: ${message}\n`);
  process.exitCode = 2;
});
