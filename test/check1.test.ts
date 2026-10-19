import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { compareSchemaToMap } from "../src/check1/compare.js";
import { checkMapVsMigrations } from "../src/check1/check-map-vs-migrations.js";
import { discoverMigrationFiles } from "../src/check1/discover-migrations.js";
import {
  createNodeSqliteSchemaReader,
  loadNodeSqlite,
} from "../src/check1/node-sqlite-schema-reader.js";
import type { SchemaReader, SchemaSnapshot } from "../src/check1/types.js";
import { parseDataMap } from "../src/data-map/parse.js";

const weMetDir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures/we-met");

const operationalTableMap = `schema_version: 1
d1_tables:
  items:
    defaults:
      whose: operational
      data: x
      purpose: y
      processors: []
      retention: r
    columns:
      id: {}
other_items: []
`;

const mixedTableMap = `schema_version: 1
d1_tables:
  people:
    columns:
      id:
        whose: operational
        data: id
        purpose: pk
        processors: []
        retention: r
      email:
        whose: card_owner
        data: email
        purpose: contact
        processors: []
        retention: r
other_items: []
`;

function parseMap(yaml: string, filePath = "data-map.yml") {
  const result = parseDataMap(yaml, filePath);
  if ("fatal" in result) {
    throw new Error(result.fatal.message);
  }
  return result.map;
}

function writeFixture(
  root: string,
  files: { map?: string; migrations?: Record<string, string> },
): { mapPath: string; migrationsDir: string } {
  const migrationsDir = join(root, "migrations");
  mkdirSync(migrationsDir, { recursive: true });
  const mapPath = join(root, "data-map.yml");
  if (files.map !== undefined) {
    writeFileSync(mapPath, files.map, "utf8");
  }
  if (files.migrations) {
    for (const [name, sql] of Object.entries(files.migrations)) {
      writeFileSync(join(migrationsDir, name), sql, "utf8");
    }
  }
  return { mapPath, migrationsDir };
}

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "nodrift-check1-"));
  tempRoots.push(root);
  return root;
}

describe("checkMapVsMigrations we-met fixture", () => {
  it("passes with 11 tables and 70 columns", () => {
    const result = checkMapVsMigrations({
      mapFilePath: join(weMetDir, "data-map.grouped.yml"),
      migrationsDir: join(weMetDir, "migrations"),
    });
    expect(result).toEqual({
      kind: "ok",
      outcome: "checked",
      tableCount: 11,
      columnCount: 70,
    });
  });
});

describe("checkMapVsMigrations synthetic", () => {
  it("returns nothing_to_check for empty map and no migrations", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: "schema_version: 1\n",
    });
    expect(checkMapVsMigrations({ mapFilePath: mapPath, migrationsDir })).toEqual({
      kind: "ok",
      outcome: "nothing_to_check",
      tableCount: 0,
      columnCount: 0,
    });
  });

  it("fatal when map declares D1 tables but migrations are missing", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: operationalTableMap,
    });
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
    });
    expect(result.kind).toBe("fatal");
    if (result.kind === "fatal") {
      expect(result.fatal.message).toBe(
        `no migrations found at \`${migrationsDir}\` but the map declares D1 tables; check the \`migrations\` path`,
      );
    }
  });

  it("returns loader findings without comparing (TODO whose)", () => {
    const root = tempRoot();
    const yaml = `schema_version: 1
d1_tables:
  t:
    columns:
      id:
        whose: TODO
        data: d
        purpose: p
        processors: []
        retention: r
other_items: []
`;
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: yaml,
      migrations: {
        "001.sql": "CREATE TABLE t (id TEXT PRIMARY KEY);",
      },
    });
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
    });
    expect(result.kind).toBe("findings");
    if (result.kind === "findings") {
      expect(result.findings.some((f) => f.code === "whose_todo")).toBe(true);
      expect(result.findings.some((f) => f.code === "column_not_in_map")).toBe(false);
    }
  });

  it("reports migration file name and SQL error on failure", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: operationalTableMap,
      migrations: {
        "001_ok.sql": "CREATE TABLE items (id TEXT PRIMARY KEY);",
        "002_bad.sql": "NOT VALID SQL;",
      },
    });
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
    });
    expect(result.kind).toBe("fatal");
    if (result.kind === "fatal") {
      expect(result.fatal.file).toContain("002_bad.sql");
      expect(result.fatal.message).toContain("002_bad.sql");
      expect(result.fatal.message).toMatch(/failed:/);
    }
  });

  it("sorts migration files by file name", () => {
    const root = tempRoot();
    const migrationsDir = join(root, "migrations");
    mkdirSync(migrationsDir);
    writeFileSync(join(migrationsDir, "010_second.sql"), "-- b");
    writeFileSync(join(migrationsDir, "002_first.sql"), "-- a");
    writeFileSync(join(migrationsDir, "readme.txt"), "skip");
    const discovered = discoverMigrationFiles(migrationsDir);
    expect(discovered.ok).toBe(true);
    if (discovered.ok) {
      expect(discovered.migrations.map((f) => f.fileName)).toEqual([
        "002_first.sql",
        "010_second.sql",
      ]);
    }
  });

  it("suggests {} for undeclared column on operational table", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: operationalTableMap,
      migrations: {
        "001.sql":
          "CREATE TABLE items (id TEXT PRIMARY KEY, extra TEXT NOT NULL DEFAULT '');",
      },
    });
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
    });
    expect(result.kind).toBe("findings");
    if (result.kind === "findings") {
      const col = result.findings.find((f) => f.code === "column_not_in_map");
      expect(col?.path).toBe("d1_tables.items.columns.extra");
      expect(col?.fix).toContain("extra: {}");
    }
  });

  it("suggests { whose: TODO } for undeclared column on mixed table", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: mixedTableMap,
      migrations: {
        "001.sql":
          "CREATE TABLE people (id TEXT PRIMARY KEY, email TEXT, nickname TEXT);",
      },
    });
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
    });
    expect(result.kind).toBe("findings");
    if (result.kind !== "findings") {
      return;
    }
    const col = result.findings.find(
      (f) => f.code === "column_not_in_map" && f.path.endsWith(".nickname"),
    );
    expect(col?.fix).toContain("nickname: { whose: TODO }");
  });

  it("emits one table_not_in_map finding for a wholly undeclared table", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: operationalTableMap,
      migrations: {
        "001.sql": `CREATE TABLE items (id TEXT PRIMARY KEY);
CREATE TABLE shadow (a TEXT, b TEXT);`,
      },
    });
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
    });
    expect(result.kind).toBe("findings");
    if (result.kind !== "findings") {
      return;
    }
    const tableFindings = result.findings.filter((f) => f.code === "table_not_in_map");
    expect(tableFindings).toHaveLength(1);
    expect(tableFindings?.[0].path).toBe("d1_tables.shadow");
    expect(tableFindings?.[0].fix).toContain("whose: TODO");
  });

  it("reports stale column and table in map", () => {
    const root = tempRoot();
    const yaml = `schema_version: 1
d1_tables:
  items:
    defaults:
      whose: operational
      data: x
      purpose: y
      processors: []
      retention: r
    columns:
      id: {}
      removed: {}
  ghost:
    defaults:
      whose: operational
      data: x
      purpose: y
      processors: []
      retention: r
    columns:
      id: {}
other_items: []
`;
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: yaml,
      migrations: {
        "001.sql": "CREATE TABLE items (id TEXT PRIMARY KEY);",
      },
    });
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
    });
    expect(result.kind).toBe("findings");
    if (result.kind !== "findings") {
      return;
    }
    expect(result.findings.some((f) => f.code === "column_not_in_schema")).toBe(true);
    expect(result.findings.some((f) => f.code === "table_not_in_schema")).toBe(true);
  });

  it("adds case-only mismatch hint", () => {
    const map = parseMap(operationalTableMap);
    const schema: SchemaSnapshot = new Map([["items", ["ID"]]]);
    const findings = compareSchemaToMap(schema, map, "m.yml");
    const col = findings.find((f) => f.code === "column_not_in_map");
    expect(col?.message).toContain("differ only in case");
  });

  it("ignores sqlite_sequence, _cf_KV, and d1_migrations", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: operationalTableMap,
      migrations: {
        "001.sql": `CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT);
CREATE TABLE d1_migrations (id INT);
CREATE TABLE _cf_KV (k TEXT);`,
      },
    });
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
    });
    expect(result.kind).toBe("ok");
  });

  it("honors ignoreTables case-insensitively", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: operationalTableMap,
      migrations: {
        "001.sql": `CREATE TABLE items (id TEXT PRIMARY KEY);
CREATE TABLE FTS_Shadow (x TEXT);`,
      },
    });
    const without = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
    });
    expect(without.kind).toBe("findings");

    const withIgnore = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
      ignoreTables: ["fts_shadow"],
    });
    expect(withIgnore.kind).toBe("ok");
  });

  it("includes stored and virtual generated columns", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: `schema_version: 1
d1_tables:
  g:
    defaults:
      whose: operational
      data: x
      purpose: y
      processors: []
      retention: r
    columns:
      a: {}
      b_stored: {}
      c_virtual: {}
other_items: []
`,
      migrations: {
        "001.sql": `CREATE TABLE g (
  a INT,
  b_stored INT GENERATED ALWAYS AS (a + 1) STORED,
  c_virtual INT GENERATED ALWAYS AS (a + 2) VIRTUAL
);`,
      },
    });
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
    });
    expect(result).toMatchObject({ kind: "ok", outcome: "checked" });
  });

  // node:sqlite lacks fts5 below Node 22.16 (see README); shadow names match real D1 side tables.
  it("FTS5-style shadow table names appear as undeclared unless ignored", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: operationalTableMap,
      migrations: {
        "001.sql": `CREATE TABLE items (id TEXT PRIMARY KEY);
CREATE TABLE f_config (k TEXT);
CREATE TABLE f_data (rowid INTEGER, content TEXT);`,
      },
    });
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
    });
    expect(result.kind).toBe("findings");
    if (result.kind !== "findings") {
      return;
    }
    const tables = result.findings.filter((f) => f.code === "table_not_in_map");
    expect(tables.some((t) => t.path === "d1_tables.f_config")).toBe(true);
    expect(tables.some((t) => t.path === "d1_tables.f_data")).toBe(true);
  });

  it("handles DROP COLUMN via migration", () => {
    const root = tempRoot();
    const yaml = `schema_version: 1
d1_tables:
  t:
    defaults:
      whose: operational
      data: x
      purpose: y
      processors: []
      retention: r
    columns:
      id: {}
other_items: []
`;
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: yaml,
      migrations: {
        "001.sql": "CREATE TABLE t (id TEXT, drop_me TEXT);",
        "002.sql": "ALTER TABLE t DROP COLUMN drop_me;",
      },
    });
    expect(checkMapVsMigrations({ mapFilePath: mapPath, migrationsDir }).kind).toBe(
      "ok",
    );
  });

  it("handles RENAME COLUMN", () => {
    const root = tempRoot();
    const yaml = `schema_version: 1
d1_tables:
  t:
    defaults:
      whose: operational
      data: x
      purpose: y
      processors: []
      retention: r
    columns:
      new_name: {}
other_items: []
`;
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: yaml,
      migrations: {
        "001.sql": "CREATE TABLE t (old_name TEXT);",
        "002.sql": "ALTER TABLE t RENAME COLUMN old_name TO new_name;",
      },
    });
    expect(checkMapVsMigrations({ mapFilePath: mapPath, migrationsDir }).kind).toBe(
      "ok",
    );
  });

  it("handles table rebuild migration", () => {
    const root = tempRoot();
    const yaml = `schema_version: 1
d1_tables:
  t:
    defaults:
      whose: operational
      data: x
      purpose: y
      processors: []
      retention: r
    columns:
      id: {}
      v: {}
other_items: []
`;
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: yaml,
      migrations: {
        "001.sql": "CREATE TABLE t (id TEXT, old_col TEXT);",
        "002.sql": `
CREATE TABLE t_new (id TEXT, v TEXT);
INSERT INTO t_new (id, v) SELECT id, old_col FROM t;
DROP TABLE t;
ALTER TABLE t_new RENAME TO t;
`,
      },
    });
    expect(checkMapVsMigrations({ mapFilePath: mapPath, migrationsDir }).kind).toBe(
      "ok",
    );
  });

  it("fatal when a migrations entry is a directory named x.sql", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: "schema_version: 1\n",
      migrations: {},
    });
    mkdirSync(join(migrationsDir, "x.sql"));
    const result = checkMapVsMigrations({ mapFilePath: mapPath, migrationsDir });
    expect(result.kind).toBe("fatal");
    if (result.kind === "fatal") {
      expect(result.fatal.message).toMatch(/cannot read migration `x\.sql`/);
      expect(result.fatal.message).toMatch(/EISDIR/i);
    }
  });

  it("fatal on EACCES reading migrations directory (not nothing_to_check)", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: "schema_version: 1\n",
    });
    const eacces = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
    eacces.code = "EACCES";
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
      migrationFs: {
        readdirSync() {
          throw eacces;
        },
        readFileSync() {
          return "";
        },
      },
    });
    expect(result.kind).toBe("fatal");
    if (result.kind === "fatal") {
      expect(result.fatal.message).toContain("cannot read migrations directory");
      expect(result.fatal.message).toMatch(/EACCES/i);
    }
    expect(result).not.toMatchObject({ kind: "ok", outcome: "nothing_to_check" });
  });

  it("fatal on readFileSync failure for a migration file", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: operationalTableMap,
      migrations: { "001.sql": "CREATE TABLE items (id TEXT);" },
    });
    const eacces = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
    eacces.code = "EACCES";
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
      migrationFs: {
        readdirSync() {
          return ["001.sql"];
        },
        readFileSync() {
          throw eacces;
        },
      },
    });
    expect(result.kind).toBe("fatal");
    if (result.kind === "fatal") {
      expect(result.fatal.message).toMatch(/cannot read migration `001\.sql`/);
    }
  });

  it("treats ENOENT migrations path as missing (nothing_to_check with empty map)", () => {
    const root = tempRoot();
    const mapPath = join(root, "data-map.yml");
    writeFileSync(mapPath, "schema_version: 1\n", "utf8");
    const missingDir = join(root, "no-such-migrations");
    expect(
      checkMapVsMigrations({ mapFilePath: mapPath, migrationsDir: missingDir }),
    ).toEqual({
      kind: "ok",
      outcome: "nothing_to_check",
      tableCount: 0,
      columnCount: 0,
    });
  });

  it("treats migrations path that is a regular file as missing", () => {
    const root = tempRoot();
    const mapPath = join(root, "data-map.yml");
    writeFileSync(mapPath, "schema_version: 1\n", "utf8");
    const filePath = join(root, "not-a-dir");
    writeFileSync(filePath, "x", "utf8");
    expect(
      checkMapVsMigrations({ mapFilePath: mapPath, migrationsDir: filePath }),
    ).toEqual({
      kind: "ok",
      outcome: "nothing_to_check",
      tableCount: 0,
      columnCount: 0,
    });
  });

  it("appends FTS5 module hint when migration fails with no such module", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: operationalTableMap,
      migrations: { "001.sql": "--" },
    });
    const fake: SchemaReader = {
      replayMigrations() {
        return {
          ok: false,
          migrationFile: "001.sql",
          sqlError: "no such module: fts5",
        };
      },
    };
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
      schemaReader: fake,
    });
    expect(result.kind).toBe("fatal");
    if (result.kind === "fatal") {
      expect(result.fatal.message).toContain("no such module: fts5");
      expect(result.fatal.message).toContain("FTS5 requires Node 22.16 or newer");
    }
  });

  it("reports ignoreTables when map declares an excluded table", () => {
    const root = tempRoot();
    const yaml = `schema_version: 1
d1_tables:
  items:
    defaults:
      whose: operational
      data: x
      purpose: y
      processors: []
      retention: r
    columns:
      id: {}
  fts_shadow:
    defaults:
      whose: operational
      data: x
      purpose: y
      processors: []
      retention: r
    columns:
      x: {}
other_items: []
`;
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: yaml,
      migrations: {
        "001.sql": "CREATE TABLE items (id TEXT PRIMARY KEY);",
      },
    });
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
      ignoreTables: ["fts_shadow"],
    });
    expect(result.kind).toBe("findings");
    if (result.kind !== "findings") {
      return;
    }
    const tableFinding = result.findings.find((f) => f.code === "table_not_in_schema");
    expect(tableFinding?.message).toContain("excluded by `ignoreTables`");
    expect(tableFinding?.fix).toContain("ignoreTables");
  });

  it("orders findings by structured table and column keys (dotted table names)", () => {
    const map = parseMap("schema_version: 1\nother_items: []\n");
    const schema: SchemaSnapshot = new Map([
      ["z.z", ["a"]],
      ["z", ["b"]],
    ]);
    const findings = compareSchemaToMap(schema, map, "m.yml");
    expect(findings.map((f) => f.path)).toEqual(["d1_tables.z", "d1_tables.z.z"]);
  });

  it("uses injected fake schema reader", () => {
    const root = tempRoot();
    const { mapPath, migrationsDir } = writeFixture(root, {
      map: operationalTableMap,
      migrations: { "001.sql": "-- ignored by fake" },
    });
    const fake: SchemaReader = {
      replayMigrations() {
        return {
          ok: true,
          schema: new Map([["items", ["id"]]]),
        };
      },
    };
    const result = checkMapVsMigrations({
      mapFilePath: mapPath,
      migrationsDir,
      schemaReader: fake,
    });
    expect(result).toMatchObject({
      kind: "ok",
      outcome: "checked",
      tableCount: 1,
      columnCount: 1,
    });
  });
});

describe("node:sqlite warning filter", () => {
  it("suppresses only the SQLite experimental warning while loading", () => {
    const seen: string[] = [];
    const original = process.emitWarning;
    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      const message = typeof warning === "string" ? warning : warning.message;
      seen.push(message);
      return original(warning, ...(args as []));
    }) as typeof process.emitWarning;

    loadNodeSqlite(() => {
      process.emitWarning(
        "SQLite is an experimental feature and might change at any time",
        "ExperimentalWarning",
      );
      process.emitWarning("other warning");
      process.emitWarning(
        "SQLite is an experimental feature and might change at any time",
        {
          type: "ExperimentalWarning",
        },
      );
      return {} as ReturnType<typeof loadNodeSqlite>;
    });

    expect(seen).toEqual(["other warning"]);
    process.emitWarning = original;
  });

  it("restores process.emitWarning when the loader throws", () => {
    const original = process.emitWarning;
    expect(() =>
      loadNodeSqlite(() => {
        process.emitWarning(
          "SQLite is an experimental feature and might change at any time",
          "ExperimentalWarning",
        );
        throw new Error("load failed");
      }),
    ).toThrow("load failed");
    expect(process.emitWarning).toBe(original);
  });
});

describe("FTS5 when available", () => {
  const probeReader = createNodeSqliteSchemaReader();
  const fts5Works =
    probeReader.replayMigrations(
      [
        {
          fileName: "probe.sql",
          filePath: "probe.sql",
          sql: "CREATE VIRTUAL TABLE fts_probe USING fts5(x);",
        },
      ],
      [],
    ).ok === true;

  it.skipIf(!fts5Works)(
    "shadow tables are undeclared unless ignored; hidden columns skipped",
    () => {
      const root = tempRoot();
      const { mapPath, migrationsDir } = writeFixture(root, {
        map: operationalTableMap,
        migrations: {
          "001.sql": "CREATE VIRTUAL TABLE docs USING fts5(title, body);",
        },
      });
      const without = checkMapVsMigrations({ mapFilePath: mapPath, migrationsDir });
      expect(without.kind).toBe("findings");
      if (without.kind !== "findings") {
        return;
      }
      const tableFindings = without.findings.filter(
        (f) => f.code === "table_not_in_map",
      );
      expect(tableFindings.some((f) => f.path === "d1_tables.docs_config")).toBe(true);
      expect(tableFindings.some((f) => f.path === "d1_tables.docs_data")).toBe(true);
      expect(tableFindings.some((f) => f.path === "d1_tables.docs")).toBe(false);

      const withIgnore = checkMapVsMigrations({
        mapFilePath: mapPath,
        migrationsDir,
        ignoreTables: [
          "docs_config",
          "docs_data",
          "docs_idx",
          "docs_content",
          "docs_docsize",
        ],
      });
      expect(withIgnore.kind).toBe("ok");
    },
  );
});

describe("discoverMigrationFiles", () => {
  it("reads we-met migration files from fixture", () => {
    const discovered = discoverMigrationFiles(join(weMetDir, "migrations"));
    expect(discovered.ok).toBe(true);
    if (discovered.ok) {
      expect(discovered.migrations.length).toBe(6);
      expect(discovered.migrations[0].fileName).toBe("0001_card_lookup_schema.sql");
    }
  });
});
