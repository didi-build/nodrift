import { getLocation, parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { fatal, type FatalError } from "../findings.js";

function offsetToLineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function syntaxFatal(
  configPath: string,
  text: string,
  errors: ParseError[],
): FatalError {
  const first = errors[0];
  const loc = getLocation(text, first.offset);
  const { line, column } = offsetToLineColumn(text, first.offset);
  const code = printParseErrorCode(first.error);
  const pathHint = loc.path.length > 0 ? ` at ${formatJsonPath(loc.path)}` : "";
  return fatal(
    configPath,
    `JSONC syntax error${pathHint}: ${code} (line ${line}, column ${column})`,
  );
}

function formatJsonPath(path: readonly (string | number)[]): string {
  let result = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      result += `[${segment}]`;
    } else if (result.length === 0) {
      result = segment;
    } else {
      result += `.${segment}`;
    }
  }
  return result;
}

export type ParseWranglerResult =
  { ok: true; root: Record<string, unknown> } | { ok: false; fatal: FatalError };

export function parseWranglerConfig(
  text: string,
  configPath: string,
): ParseWranglerResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      fatal: fatal(configPath, "wrangler config is empty"),
    };
  }

  const errors: ParseError[] = [];
  const parsed = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0) {
    return { ok: false, fatal: syntaxFatal(configPath, text, errors) };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      fatal: fatal(configPath, "wrangler config root must be a JSON object"),
    };
  }

  return { ok: true, root: parsed as Record<string, unknown> };
}
