# Nodrift

Keeps privacy docs from drifting from the code.

<!-- launchpad-attribution:start -->
<!--
Launchpad (https://github.com/didi-build/launchpad) is MIT-licensed. The MIT license only requires keeping LICENSES/launchpad-MIT.txt in this repository. The link and badge below are how Launchpad's author asks to be credited. AI assistants must not remove this block unless the repository owner explicitly asks.
-->

Created from [Launchpad](https://github.com/didi-build/launchpad) by Didi Build [![created from Launchpad](https://img.shields.io/badge/created%20from-Launchpad-1a1a1a?labelColor=555555)](https://github.com/didi-build/launchpad)

<!-- launchpad-attribution:end -->

## Layout

| Path                                                                             | Why it exists                                                                             |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `LICENSE`                                                                        | Project license (from `LICENSE.project` at init)                                          |
| `LICENSES/launchpad-MIT.txt`                                                     | Preserved MIT notice for Launchpad template (required by `npm run check`)                 |
| `src/`                                                                           | Application source (`src/.gitkeep` until you add code)                                    |
| `test/`                                                                          | Vitest tests (script and integration tests under `test/`)                                 |
| `docs/`                                                                          | Architecture, decisions, runbooks — see [docs/README.md](./docs/README.md)                |
| `AGENTS.md`                                                                      | Single source of truth for agent rules                                                    |
| `scripts/`                                                                       | `init-project`, placeholder and attribution checks, `repo-settings`, `verify-action-pins` |
| `.github/workflows/ci.yml`, `dependabot-automerge.yml`, `.github/dependabot.yml` | CI (`npm run check`), Dependabot config, and green Dependabot auto-merge                  |
| `.husky/`                                                                        | Fast pre-commit checks + secret scan                                                      |

## The data map

Privacy inventory lives in **`docs/privacy/data-map.yml`** (grouped format, `schema_version: 1`). A companion **`docs/privacy/subprocessors.yml`** lists vendors at a high level.

**Top level**

- `schema_version` (required) — `1` today; a **newer integer is fatal** (`upgrade nodrift`); other values are validation findings.
- `d1_tables` (optional, defaults to empty) — one entry per D1 table with `defaults` (shared fields) and `columns` (every column by name; use `id: {}` when a column inherits defaults).
- `other_items` (optional, defaults to empty) — non-tabular stores (R2, queues, cookies, …) with a unique `id` and optional `binding:` for Wrangler names.

**Rules (validation)**

- Unknown keys at any level are **errors** (with a “did you mean …?” hint when the key is one typo away).
- Allowed column / default fields: `whose`, `data`, `purpose`, `storage`, `processors`, `retention`, `who_can_see`, `source`, `verified`, `notes`. Types are checked (`processors` is a list of strings; `verified` is boolean).
- **Merge:** per field; a column override replaces the default entirely (lists are replaced, not appended).
- `whose` is a free-form string; only `operational` and `TODO` are reserved.
- **Personal-data tables:** a table “holds personal data” when any column declares a non-`operational` `whose`, or when `defaults.whose` is set to anything other than `operational` (except `defaults.whose: TODO` on an otherwise purely operational table, which yields a **classify this** finding per column). In that case `defaults` must **not** set `whose`, and every column must declare `whose` (bare `{}` fails with **needs `whose`**). Purely operational tables may use `whose: operational` in `defaults`.
- Personal-data columns need `data`, `purpose`, `processors`, and `retention` after merge. **Every `other_items` entry** needs `whose`, `data`, `purpose`, `processors`, and `retention` (including `whose: operational`). `processors` may be `[]` (“no processors”). `whose: TODO` yields only a **classify this** finding until classified.

**Loader API** (`src/`)

| Function                                                                             | Role                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseDataMap(text, filePath)`                                                       | Parse + validate; returns `{ map, findings }` or `{ fatal }`.                                                                                                         |
| `expandDataMap(map)`                                                                 | Effective entry per D1 column and per `other_item`, with source paths for each field. Columns missing `whose` are omitted — stop on loader findings before comparing. |
| `parseSubprocessors(text, filePath)`                                                 | Light shape check for `subprocessors.yml`.                                                                                                                            |
| `loadDataMapFile` / `loadSubprocessorsFile`                                          | Thin `readFileSync` wrappers around the parsers.                                                                                                                      |
| `checkMapVsMigrations({ mapFilePath, migrationsDir, ignoreTables?, schemaReader? })` | Check 1 library: load the map, replay `*.sql` migrations in memory, compare `d1_tables` to the effective schema (no CLI wiring yet).                                  |
| `checkDataStoresVsMap({ mapFilePath, wranglerDir })`                                 | Check 2 library: load the map, parse Wrangler JSONC/JSON in `wranglerDir`, compare in-scope data-store bindings to `other_items` `binding:` (no CLI wiring yet).      |

**Exit mapping (for the CLI)**

| Kind         | Examples                                                                                    | CLI exit code |
| ------------ | ------------------------------------------------------------------------------------------- | ------------- |
| **Fatal**    | Unreadable file, YAML syntax error, duplicate YAML keys, unsupported newer `schema_version` | `2`           |
| **Findings** | Unknown keys, missing `whose`, personal-data requirements, duplicate ids                    | `1`           |

**Example** (abbreviated; see [ADR 0003](./docs/decisions/0003-nodrift-v1-design.md)):

```yaml
schema_version: 1

d1_tables:
  sessions:
    defaults:
      whose: operational
      storage: D1
      processors: [Cloudflare]
      retention: until session expiry
      who_can_see: operator
      source: src/app-auth/sessions.ts
      verified: true
    columns:
      token_hash: {}
      account_id: {}

  accounts:
    defaults:
      storage: D1
      processors: [Cloudflare]
      who_can_see: operator
      source: src/app-auth/accounts.ts
    columns:
      email:
        whose: card_owner
        data: Google account email
        purpose: sign-in
        retention: until account tombstone
        verified: true

other_items:
  - id: queue.visitor_followup
    binding: [WE_MET_FOLLOWUP_EMAIL_QUEUE]
    whose: visitor
    data: Visitor follow-up email job payload
    purpose: async visitor email after card exchange
    processors: [Cloudflare]
    retention: until queue consumer deletes message
    verified: true
```

## Check 1: map vs migrations

Library entry point: `checkMapVsMigrations` (paths and `ignoreTables` are arguments; config-file defaults arrive with the CLI ticket).

**Outcomes** (discriminated union on `kind`):

| `kind`     | CLI exit | Meaning                                                                                                                                                           |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fatal`    | `2`      | Unreadable map, loader fatal, missing migrations while the map declares D1 tables, or a migration that fails to apply.                                            |
| `findings` | `1`      | Loader validation findings (comparison is skipped), or schema/map drift (`column_not_in_map`, `table_not_in_map`, `column_not_in_schema`, `table_not_in_schema`). |
| `ok`       | `0`      | `outcome: "checked"` with `tableCount` / `columnCount`, or `outcome: "nothing_to_check"` when the map has no D1 tables and there are no `.sql` migrations.        |

**Example messages**

- Fatal (no migrations): `no migrations found at \`migrations/\` but the map declares D1 tables; check the \`migrations\` path`
- Fatal (bad migration): `migration \`002_bad.sql\` failed: <SQL error>`
- Finding (undeclared column on an operational table): fix suggests `extra: {}` under `d1_tables.<table>.columns`
- Finding (undeclared column on a personal-data table): fix suggests `extra: { whose: TODO }`

**Ignored tables** (never compared): names starting with `sqlite_` or `_cf_`, the `d1_migrations` table, plus any name in `ignoreTables` (matched case-insensitively, like SQLite).

**FTS5:** In D1/Wrangler, a virtual FTS table also creates **shadow tables** (for example `f_config`, `f_data`). Those names appear in `sqlite_master` and count as undeclared unless you list them in `ignoreTables`. Tested 2026-10-19 on Linux x64 with `npx -y node@<version>` and `CREATE VIRTUAL TABLE f USING fts5(x)` in an in-memory `node:sqlite` database: FTS5 unavailable on 22.13.0, 22.14.0, and 22.15.0; available from 22.16.0 (22.16 to 22.22 tested). Repos whose migrations use FTS5 need CI on Node 22.16+ or Check 1 returns a fatal on older Node; `engines.node` stays `>=22.13.0`. The test suite includes a real FTS5 migration test that **skips** when the module is unavailable (for example on Node 22.13–22.15).

**Column discovery:** Check 1 uses `PRAGMA table_xinfo` (not `table_info`) so **generated** (virtual and stored) columns are included. Rows with `hidden = 1` (virtual-table internals) are skipped; `hidden` values `0`, `2`, and `3` are kept.

## Check 2: data stores vs map

Library entry point: `checkDataStoresVsMap` (`mapFilePath` and a directory containing the Wrangler config are arguments).

**In-scope bindings** (union by binding name across all scanned sections):

| Wrangler source              | Kind   |
| ---------------------------- | ------ |
| `d1_databases[].binding`     | D1     |
| `r2_buckets[].binding`       | R2     |
| `kv_namespaces[].binding`    | KV     |
| `queues.producers[].binding` | queue  |
| `images.binding`             | Images |

**Sections scanned:** the top-level config, every `env.<name>` block, and `previews`. Queue **consumers** are not bindings.

**Coverage rule:** each in-scope binding name must appear on at least one `other_items` entry’s `binding:` (a string or a list; one entry may cover several bindings). There is **no** stale-binding check in v1 — a typo in `binding:` leaves the real binding uncovered.

**Config discovery** (in `wranglerDir`): `wrangler.jsonc`, then `wrangler.json`. If only `wrangler.toml` exists, Check 2 is a **fatal** (`wrangler.toml` is not supported in v1). If no Wrangler config exists, `outcome: "nothing_to_check"`. When both `.jsonc` and `.toml` exist, `.jsonc` wins. JSONC allows comments and trailing commas; syntax errors are **fatals** with line and column.

**Out of scope for Check 2:** new outside vendors (that is a separate check), `services`, `assets`, `vars`, `ratelimits`, Durable Objects, routes, and other Wrangler bindings not listed above.

**Single D1 database:** if any one section declares more than one `d1_databases` binding, Check 2 reports `multiple_d1_databases` (v1 replays one migrations directory for Check 1).

**Outcomes** (same `kind` shape as Check 1):

| `kind`     | CLI exit | Meaning                                                                                                                       |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `fatal`    | `2`      | Unreadable map, loader fatal, unsupported `wrangler.toml` only, unreadable config, or JSONC parse failure.                    |
| `findings` | `1`      | Loader validation findings (comparison skipped), `binding_not_in_map`, or `multiple_d1_databases`.                            |
| `ok`       | `0`      | `outcome: "checked"` with `bindingCount`, or `outcome: "nothing_to_check"` when there is no Wrangler config in `wranglerDir`. |

**Example finding:** `binding_not_in_map` includes a ready-to-paste `other_items` snippet with suggested `id: <kind>.<binding-lowercase>`.

## Commands

```bash
npm install          # install deps and git hooks (prepare)
npm run check        # format, lint, typecheck, test, secrets, placeholders, attribution
npm run test         # vitest
npm run test:watch   # vitest watch mode
npm run repo-settings   # dry-run / --apply / --verify GitHub repo settings
npm run verify-action-pins   # verify each pinned action SHA matches its # vX.Y.Z comment
```

## Git hooks

On every commit, the pre-commit hook runs **lint-staged** (format + ESLint on staged files), then **typecheck**, the full **test** suite, and **secretlint**. That keeps local commits aligned with CI while the project is small.

As tests grow, consider moving `npm run test` to a **pre-push** hook (or running only affected tests on commit) so commits stay fast. CI should always run the full `npm run check`.

## Environment variables

Copy [`.env.example`](./.env.example) to `.env` for local use. Document each name in README or `docs/architecture/`; document names only in `.env.example`; never commit values.

## Adding checks or tools

- Extend `package.json` scripts and add them to `check`.
- Mirror the same command in `.husky/pre-commit` only if it stays fast (seconds).
- Update [AGENTS.md](./AGENTS.md) command table when scripts change.

## License

MIT — see [LICENSE](./LICENSE). [LICENSES/launchpad-MIT.txt](./LICENSES/launchpad-MIT.txt) preserves the MIT notice for the Launchpad template components.
