import type { Finding, FatalError } from "../findings.js";

export type SchemaSnapshot = ReadonlyMap<string, readonly string[]>;

export type MigrationFile = {
  fileName: string;
  filePath: string;
  sql: string;
};

export type ReplayMigrationsResult =
  | { ok: true; schema: SchemaSnapshot }
  | { ok: false; migrationFile: string; sqlError: string };

/** Applies migrations and reads the effective D1 column layout. */
export type SchemaReader = {
  replayMigrations(
    migrations: MigrationFile[],
    ignoreTables: readonly string[],
  ): ReplayMigrationsResult;
};

export type CheckMapVsMigrationsOk = {
  kind: "ok";
  outcome: "checked" | "nothing_to_check";
  tableCount: number;
  columnCount: number;
};

export type CheckMapVsMigrationsFindings = {
  kind: "findings";
  findings: Finding[];
};

export type CheckMapVsMigrationsFatal = {
  kind: "fatal";
  fatal: FatalError;
};

export type CheckMapVsMigrationsResult =
  CheckMapVsMigrationsOk | CheckMapVsMigrationsFindings | CheckMapVsMigrationsFatal;
