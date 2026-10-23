import { readFileSync } from "node:fs";
import {
  getLocation,
  parse,
  printParseErrorCode,
  type JSONPath,
  type ParseError,
} from "jsonc-parser";
import { fatal, type FatalError } from "../findings.js";

export type WranglerReadFs = {
  readFileSync(path: string, encoding: "utf8"): string;
};

const defaultFs: WranglerReadFs = {
  readFileSync(path, encoding) {
    return readFileSync(path, encoding);
  },
};

function formatErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function stripLeadingBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}

function offsetToLineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function formatJsonPath(path: JSONPath): string {
  if (path.length === 0) {
    return "";
  }
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

function firstParseErrorMessage(text: string, errors: ParseError[]): string {
  const first = errors[0];
  const { line, column } = offsetToLineColumn(text, first.offset);
  const location = getLocation(text, first.offset);
  const path = formatJsonPath(location.path);
  const codeName = printParseErrorCode(first.error);
  const atPath = path.length > 0 ? ` at ${path}` : "";
  return `JSONC syntax error${atPath}: ${codeName} (line ${line}, column ${column})`;
}

export type ParseWranglerResult =
  { ok: true; config: Record<string, unknown> } | { ok: false; fatal: FatalError };

function parseWranglerJsoncText(
  configPath: string,
  withoutBom: string,
): ParseWranglerResult {
  const errors: ParseError[] = [];
  const value = parse(withoutBom, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0) {
    return {
      ok: false,
      fatal: fatal(configPath, firstParseErrorMessage(withoutBom, errors)),
    };
  }

  if (
    value === undefined ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {
      ok: false,
      fatal: fatal(configPath, "Wrangler config root must be a JSON object"),
    };
  }

  return { ok: true, config: value as Record<string, unknown> };
}

export function parseWranglerConfigFile(
  configPath: string,
  fs: WranglerReadFs = defaultFs,
): ParseWranglerResult {
  let text: string;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      fatal: fatal(
        configPath,
        `cannot read Wrangler config \`${configPath}\`: ${formatErr(err)}`,
      ),
    };
  }

  const withoutBom = stripLeadingBom(text);

  if (withoutBom.trim().length === 0) {
    return {
      ok: false,
      fatal: fatal(configPath, "Wrangler config is empty"),
    };
  }

  return parseWranglerJsoncText(configPath, withoutBom);
}
