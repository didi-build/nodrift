import { parseArgs } from "node:util";

const KNOWN_OPTIONS = new Set(["help", "version", "config", "dry-run"]);

export type ParsedCli =
  | {
      ok: true;
      command: "check" | "init" | "sync";
      dryRun: boolean;
      configPath?: string;
      help: boolean;
      version: boolean;
    }
  | { ok: false; usageError: true };

export function parseCli(argv: string[]): ParsedCli {
  const { values, positionals, tokens } = parseArgs({
    args: argv,
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
    if (token.kind === "option" && !KNOWN_OPTIONS.has(token.name)) {
      return { ok: false, usageError: true };
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (
      token.kind === "option" &&
      token.name === "config" &&
      token.rawName === "--config"
    ) {
      const hasValue =
        "value" in token && typeof token.value === "string" && token.value.length > 0;
      if (!hasValue) {
        return { ok: false, usageError: true };
      }
    }
  }

  if (values.config === "") {
    return { ok: false, usageError: true };
  }

  if (values.help) {
    return {
      ok: true,
      help: true,
      version: false,
      command: "check",
      dryRun: false,
    };
  }

  if (values.version) {
    return {
      ok: true,
      help: false,
      version: true,
      command: "check",
      dryRun: false,
    };
  }

  const command = positionals[0];
  if (!command) {
    return { ok: false, usageError: true };
  }

  if (positionals.length > 1) {
    return { ok: false, usageError: true };
  }

  if (command === "sync") {
    return {
      ok: true,
      help: false,
      version: false,
      command: "sync",
      dryRun: false,
    };
  }

  if (command !== "check" && command !== "init") {
    return { ok: false, usageError: true };
  }

  const dryRun = values["dry-run"] === true;
  if (dryRun && command !== "init") {
    return { ok: false, usageError: true };
  }

  const configPath =
    typeof values.config === "string" && values.config.length > 0
      ? values.config
      : undefined;

  return {
    ok: true,
    help: false,
    version: false,
    command,
    dryRun,
    configPath,
  };
}
