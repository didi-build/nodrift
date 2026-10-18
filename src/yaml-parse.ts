import { parse, YAMLParseError } from "yaml";
import type { FatalError } from "./findings.js";
import { fatal } from "./findings.js";

export type YamlParseSuccess = {
  ok: true;
  value: unknown;
};

export type YamlParseFailure = {
  ok: false;
  error: FatalError;
};

export type YamlParseResult = YamlParseSuccess | YamlParseFailure;

export function parseYamlDocument(text: string, filePath: string): YamlParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: fatal(filePath, "file is empty") };
  }

  try {
    const value = parse(text, {
      uniqueKeys: true,
      prettyErrors: true,
    });
    return { ok: true, value };
  } catch (err) {
    if (err instanceof YAMLParseError) {
      const detail = err.message.split("\n")[0] ?? err.message;
      return {
        ok: false,
        error: fatal(filePath, `YAML syntax error: ${detail}`),
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: fatal(filePath, `YAML syntax error: ${message}`) };
  }
}
