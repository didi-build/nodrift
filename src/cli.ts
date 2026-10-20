#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadConfig } from "./config/load-config.js";
import { formatFatal } from "./cli/format-output.js";
import { runCheck } from "./cli/run-check.js";
import { runInit } from "./init/run-init.js";
import { getPackageVersion, printUsageHint, USAGE } from "./cli/usage.js";

function main(): void {
  const { values, positionals, tokens } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      config: { type: "string" },
      "dry-run": { type: "boolean" },
    },
    tokens: true,
    strict: false,
  });

  for (const token of tokens) {
    if (
      token.kind === "option" &&
      !["help", "version", "config", "dry-run"].includes(token.name)
    ) {
      printUsageHint(process.stderr);
      process.exit(2);
    }
  }

  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  if (values.version) {
    process.stdout.write(`${getPackageVersion()}\n`);
    process.exit(0);
  }

  const command = positionals[0];
  const dryRun = values["dry-run"] === true;

  if (dryRun && command !== "init") {
    printUsageHint(process.stderr);
    process.exit(2);
  }

  if (!command) {
    printUsageHint(process.stderr);
    process.exit(2);
  }

  if (command === "sync") {
    process.stderr.write("nodrift sync is not available in v1\n");
    process.exit(2);
  }

  if (command !== "check" && command !== "init") {
    printUsageHint(process.stderr);
    process.exit(2);
  }

  const configPathOption =
    typeof values.config === "string" ? values.config : undefined;
  const loaded = loadConfig(process.cwd(), configPathOption);
  if (!loaded.ok) {
    process.stderr.write(`${formatFatal(loaded.fatal)}\n`);
    process.exit(2);
  }

  if (command === "check") {
    const result = runCheck(loaded.config);
    process.stdout.write(`${result.lines.join("\n")}\n`);
    process.exit(result.exitCode);
  }

  if (command === "init") {
    const result = runInit(process.cwd(), loaded.config, dryRun);
    process.stdout.write(`${result.lines.join("\n")}\n`);
    process.exit(result.exitCode);
  }
}

main();
