/** Validation problem reported as exit code 1 by the CLI. */
export type Finding = {
  file: string;
  path: string;
  code: string;
  message: string;
  fix: string;
};

/** Unrecoverable load error reported as exit code 2 by the CLI. */
export type FatalError = {
  kind: "fatal";
  message: string;
  file: string;
};

export function finding(
  file: string,
  path: string,
  code: string,
  message: string,
  fix: string,
): Finding {
  return { file, path, code, message, fix };
}

export function fatal(file: string, message: string): FatalError {
  return { kind: "fatal", message, file };
}
