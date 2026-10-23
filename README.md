# Nodrift

Keeps privacy docs from drifting from the code.

<!-- launchpad-attribution:start -->
<!--
Launchpad (https://github.com/didi-build/launchpad) is MIT-licensed. The MIT license only requires keeping LICENSES/launchpad-MIT.txt in this repository. The link and badge below are how Launchpad's author asks to be credited. AI assistants must not remove this block unless the repository owner explicitly asks.
-->

Created from [Launchpad](https://github.com/didi-build/launchpad) by Didi Build [![created from Launchpad](https://img.shields.io/badge/created%20from-Launchpad-1a1a1a?labelColor=555555)](https://github.com/didi-build/launchpad)

<!-- launchpad-attribution:end -->

## Install

Requires **Node.js `>=22.13.0`** (`node:sqlite` for Check 1). In a consumer repo, pin an exact version and run:

```bash
npm install --save-dev @didi-build/nodrift@<version>  # pin exact; first publish will be 0.1.0
npx nodrift init    # once: scaffold owned privacy files (safe to re-run)
npx nodrift check   # in CI and locally
```

One-off without adding to `package.json`: `npx @didi-build/nodrift@<version> check`.

See [How a version bump works](./docs/version-bump.md) and [CHANGELOG.md](./CHANGELOG.md) when upgrading.

## Default layout in your repo

Zero config assumes paths like [we-met](https://github.com/didi-build/we-met):

| Path                                | Role                                            |
| ----------------------------------- | ----------------------------------------------- |
| `docs/privacy/data-map.yml`         | Grouped privacy inventory (`schema_version: 1`) |
| `docs/privacy/subprocessors.yml`    | Vendor list (validated when present)            |
| `migrations/*.sql`                  | D1 migrations replayed for Check 1              |
| `wrangler.jsonc` or `wrangler.json` | Wrangler config directory (default: repo root)  |
| `nodrift.config.json`               | Optional path overrides (strict JSON)           |
| `.nodrift/manifest.json`            | Written by `init` when it creates files         |

`init` may also add runbooks, `SECURITY.md`, and a PR template — see [**`init`**](#init) below.

## What `check` verifies (v1)

| Step              | Verifies                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Map loader**    | YAML shape, `schema_version`, personal-data rules, required fields, unknown keys                                             |
| **Check 1**       | Every D1 column from applied migrations appears in `d1_tables`, and map tables/columns exist in the schema (both directions) |
| **Check 2**       | Every in-scope Wrangler data-store binding (D1, R2, KV, queue producers, Images) is listed on an `other_items` `binding:`    |
| **Subprocessors** | `subprocessors.yml` shape when the configured file exists                                                                    |

## What `check` does not cover (v1)

- New **outside vendors** (email, analytics, etc.) — only Cloudflare bindings appear in Wrangler; use the PR privacy checklist.
- **PII in logs**, **third-party scripts**, policy generation, `wrangler.toml`-only projects.
- **Stale `binding:` entries** — a map name that matches no Wrangler binding is not reported (Check 2 only checks Wrangler bindings against the map, not the reverse).
- Toggling checks off in config — all v1 checks always run when inputs exist.

## Unsupported Wrangler configs (fail `check`)

`check` exits **`1`** (no bypass in v1) when Wrangler JSON/JSONC declares:

| Config                                                                                              | Finding code            | Rule                                                                                                   |
| --------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| More than one `d1_databases` entry in the **same** section (top level, `env.<name>`, or `previews`) | `multiple_d1_databases` | The same binding repeated across **different** sections is fine (for example production and previews). |
| Any `durable_objects.bindings` entry                                                                | `durable_objects`       | Durable Objects are not in Check 2’s in-scope binding list in v1.                                      |

Messages name the binding(s) and file, say **not supported yet by nodrift**, and link [ADR 0003 — Proposed changes](./docs/decisions/0003-nodrift-v1-design.md#proposed-changes-for-maintainer-review) (decision [DIDI-702](https://linear.app/didi-build/issue/DIDI-702)).

## v1 and v2

|          | **v1 (this release)**                                      | **v2 (planned)**                            |
| -------- | ---------------------------------------------------------- | ------------------------------------------- |
| Commands | `init`, `check`; `sync` reserved (exits `2`)               | `sync` for **managed** template files       |
| Checks   | Map vs migrations; data stores vs map; subprocessors shape | PII-in-logs, third-party scripts, more      |
| `init`   | Creates **owned** files only; manifest records `kind`      | May add **managed** files updated by `sync` |
| Output   | Human-readable stdout                                      | `--json` planned                            |

Design detail: [ADR 0003](./docs/decisions/0003-nodrift-v1-design.md).

## Owned vs managed files

- **`owned`** — created by `init`, edited by your team; never overwritten by nodrift v1.
- **`managed`** — reserved for v2: kit-owned templates that `sync` will regenerate from the package.

`.nodrift/manifest.json` stores `path`, `kind`, package `version` at creation time, and `sha256` of the original content. A **version bump** updates the CLI and checks in `node_modules`; it does not rewrite your owned docs. After a minor release with new checks, fix failures on the Dependabot PR using messages and [CHANGELOG.md](./CHANGELOG.md).

## Versioning

`@didi-build/nodrift` uses **SemVer**:

- **Patch** — fixes and clearer diagnostics; no new failures on unchanged repos.
- **Minor** — new checks or optional scaffolds/config; new checks **fail CI** until fixed (changelog lists remedies).
- **Major** — breaking `schema_version`, or removed/renamed commands, flags, config keys, or exit codes. Package major **N** supports map **`schema_version` N** only.

Publish **`0.x`** until [we-met adoption](https://linear.app/didi-build/issue/DIDI-651); **`1.0.0`** after that. Deprecations warn for one minor before removal. Pin exact versions in consumer repos.

**Consumer workflow:** [How a version bump works](./docs/version-bump.md). **Release history:** [CHANGELOG.md](./CHANGELOG.md).

## Layout (this repository)

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

| Function                                                                                    | Role                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseDataMap(text, filePath)`                                                              | Parse + validate; returns `{ map, findings }` or `{ fatal }`.                                                                                                         |
| `expandDataMap(map)`                                                                        | Effective entry per D1 column and per `other_item`, with source paths for each field. Columns missing `whose` are omitted — stop on loader findings before comparing. |
| `parseSubprocessors(text, filePath)`                                                        | Light shape check for `subprocessors.yml`.                                                                                                                            |
| `loadDataMapFile` / `loadSubprocessorsFile`                                                 | Thin `readFileSync` wrappers around the parsers.                                                                                                                      |
| `checkMapVsMigrations({ mapFilePath, migrationsDir, ignoreTables?, schemaReader? })`        | Check 1: replay `*.sql` migrations in memory and compare `d1_tables` to the effective schema.                                                                         |
| `checkDataStoresVsMap({ mapFilePath, wranglerDir })`                                        | Check 2 (legacy): one Wrangler directory, JSON/JSONC precedence, TOML-only fatal.                                                                                     |
| `checkDataStoresVsMap({ mapFilePath, repoRoot, wranglerSearchDir?, wranglerConfigPaths? })` | Check 2 (CLI): discover configs under `wranglerSearchDir` or check explicit `wranglerConfigPaths`.                                                                    |

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

Library entry point: `checkMapVsMigrations` (paths and `ignoreTables` match `nodrift.config.json` / defaults when run via the CLI).

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

Library entry points: `checkDataStoresVsMap` with `repoRoot` (and optional `wranglerSearchDir` / `wranglerConfigPaths`) matches the CLI; the `wranglerDir`-only form keeps the original single-directory behavior for callers that pass one directory.

**In-scope Wrangler bindings** (each must appear on at least one `other_items` entry’s **`binding:`** — string or list; one row may cover several names):

| Kind   | Wrangler path                                             |
| ------ | --------------------------------------------------------- |
| D1     | `d1_databases[].binding`                                  |
| R2     | `r2_buckets[].binding`                                    |
| KV     | `kv_namespaces[].binding`                                 |
| Queue  | `queues.producers[].binding` (consumers are not bindings) |
| Images | `images.binding`                                          |

**Sections scanned:** the top-level config, every `env.<name>` block, and `previews`. The same binding name in multiple sections is merged (one finding lists every section, for example `top level and previews`).

**Out of scope for Check 2:** new outside vendors (human PR checklist), `services`, `assets`, `vars`, `ratelimits`, `routes`, and other Wrangler binding types. Map rows may still mention rate-limiter **names** in `binding:`; Check 2 only requires coverage for bindings that exist in the Wrangler config. **`durable_objects` bindings fail `check`** instead of being compared (see [Unsupported Wrangler configs](#unsupported-wrangler-configs-fail-check)).

**Wrangler config discovery (CLI):** the `wrangler` key is the **search root** (default `.`). Check 2 walks that tree (without following symbolic links) and checks every directory that contains `wrangler.json` or `wrangler.jsonc` (`wrangler.json` wins when both exist, matching Wrangler; `wrangler.jsonc skipped: <path>` is printed on stdout). A search root that points at a single worker directory still checks that directory; discovery adds nested configs elsewhere under the root. Skipped directory names include `node_modules`, `dist`, `build`, `coverage`, `test-results`, `.git`, `.svn`, `.hg`, `.next`, `.open-next`, `.cache`, `.turbo`, `.vercel`, `.husky`, `.nodrift`, `.wrangler`, `out`, `.output`, and `.svelte-kit`. Nested directories that cannot be read (`EACCES` / `EPERM`) print `cannot read directory, skipped: <path>` on stdout and are skipped; an unreadable **search root** is still a fatal. If discovery finds **no** JSON/JSONC configs but does find `wrangler.toml`, Check 2 exits `2` (same as a TOML-only legacy directory). When at least one JSON/JSONC config is found, each `wrangler.toml` prints `wrangler.toml is unsupported, skipped: <path>` on stdout and is not checked.

**Explicit list:** set `wranglerConfigs` in `nodrift.config.json` to an array of `wrangler.json` / `wrangler.jsonc` paths (relative to the repo root). When this key is present (even as `[]`), discovery is skipped and the `wrangler` search root is ignored (`nodrift check` prints a warning when `wrangler` is not `.`).

**Legacy library API (`wranglerDir` only):** same per-directory precedence for JSON/JSONC as Wrangler (`wrangler.json`, then `wrangler.jsonc`), but **`wrangler.toml` only** is still a **fatal** (`use wrangler.jsonc`). A **missing** `wranglerDir`, a **non-directory** `wranglerDir`, or any **unreadable** directory is a **fatal** naming the path (`check the \`wrangler\` path`).

If no Wrangler configs are found (discovery or legacy), Check 2 returns **`ok`** with `outcome: "nothing_to_check"` only when no `other_items` entry has a `binding:`. If the map lists any `binding:` but no config files are found, that is a **fatal** listing those binding names.

Each finding’s `file` field is the Wrangler config path that declared the binding.

JSONC allows comments and trailing commas; a leading UTF-8 BOM is stripped before parse. Parse errors are **fatals** with a JSONC property path (when known), error name, and line/column.

**Single D1 database per section:** more than one `d1_databases` entry in the same section yields `multiple_d1_databases` (see [Unsupported Wrangler configs](#unsupported-wrangler-configs-fail-check); v1 replays one migrations directory in Check 1).

**No stale-binding check in v1** — map `binding:` names with no Wrangler counterpart are not reported; Check 2 only checks Wrangler bindings against the map, not the reverse.

**Outcomes** (same `kind` / `outcome` shape as Check 1):

| `kind`     | CLI exit | Meaning                                                                                                               |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `fatal`    | `2`      | Unreadable map, loader fatal, unreadable Wrangler dir, TOML-only config, or invalid/empty Wrangler JSON.              |
| `findings` | `1`      | Loader validation findings (comparison skipped), `binding_not_in_map`, `multiple_d1_databases`, or `durable_objects`. |
| `ok`       | `0`      | `outcome: "checked"` with `bindingCount`, or `outcome: "nothing_to_check"` when there is no Wrangler config.          |

**Example fix** (`binding_not_in_map`):

```yaml
other_items:
  - id: d1.we_met_db
    binding: WE_MET_DB
    whose: TODO
    data: TODO
    purpose: TODO
    processors: [Cloudflare]
    retention: TODO
```

## CLI

Build once (`npm run build`) or rely on `npm test` (Vitest runs the build via `globalSetup`). Nodrift runs against **`process.cwd()`** as the repo root; every config path is relative to that directory unless it is absolute.

### Commands

| Command                                      | Purpose                                                           |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `nodrift check [--config <path>]`            | Run Check 1, Check 2, and optional `subprocessors.yml` validation |
| `nodrift init [--dry-run] [--config <path>]` | Idempotent scaffold of owned privacy files (never overwrites)     |
| `nodrift sync`                               | Reserved for v2 — prints a message and exits `2`                  |
| `nodrift --help` / `-h`                      | Usage on stdout                                                   |
| `nodrift --version` / `-v`                   | Package version on stdout                                         |

Misuse (unknown command/flag, extra arguments, `--dry-run` except with `init`, missing `--config` value) prints a usage hint on **stderr** and exits `2`.

### Configuration

Missing `nodrift.config.json` is fine (zero config). `--config <path>` must exist or exit `2`. Strict JSON (no comments); unknown keys, wrong types, and empty strings are errors. A leading UTF-8 BOM is stripped before parse.

**Defaults** (match [`we-met`](https://github.com/didi-build/we-met)):

| Key               | Default                          | Meaning                                                                                                    |
| ----------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `map`             | `docs/privacy/data-map.yml`      | Data map file                                                                                              |
| `subprocessors`   | `docs/privacy/subprocessors.yml` | Subprocessors file                                                                                         |
| `migrations`      | `migrations`                     | Migrations **directory**                                                                                   |
| `wrangler`        | `.`                              | Check 2 **search root** for discovering JSON/JSONC Wrangler configs                                        |
| `wranglerConfigs` | _(unset)_                        | Optional explicit Wrangler config paths; discovery is skipped whenever this key is present (`[]` included) |
| `ignoreTables`    | `[]`                             | Extra tables excluded from Check 1 and migration scaffolding                                               |

Paths are resolved with `path.resolve(repoRoot, value)` so **absolute paths** in the config work as-is.

Example:

```json
{
  "map": "docs/privacy/data-map.yml",
  "migrations": "migrations",
  "wrangler": ".",
  "wranglerConfigs": ["workers/followup-email/wrangler.jsonc"],
  "ignoreTables": ["fts_data"]
}
```

### Exit codes (`check`)

| Code | Meaning        | Examples                                                                                                     |
| ---- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| `0`  | Pass           | Checks ok, or nothing to check                                                                               |
| `1`  | Problems found | Map/schema/binding drift, loader findings, subprocessors shape issues                                        |
| `2`  | Cannot run     | Unreadable files, YAML/JSON fatals, bad config, failed migration replay, bad `migrations` / `wrangler` paths |

`check` writes diagnostics to **stdout**; config and usage errors go to **stderr**.

### `init`

**Creates** (create-only, never overwrites):

- Configured `map` and `subprocessors` paths
- `docs/runbooks/breach-response.md`, `docs/privacy/breach-record-template.md`, `docs/runbooks/account-deletion.md`
- `SECURITY.md`
- `.github/pull_request_template.md` when no PR template is detected
- `.nodrift/manifest.json` when at least one file is created in that run

**Skip rules:** existing files are reported as `skipped <path> (exists)`. Corrupt or unsupported manifests exit `2` before any write. Parent paths that exist as non-directories exit `2` with no writes. `--dry-run` prints `would create` / `would skip` lines and writes nothing.

**Starter map:** replays migrations (honoring `ignoreTables`) and scaffolds each column as `{ whose: TODO }` only. With no migrations: `schema_version: 1`, `d1_tables: {}`, `other_items: []`.

**PR template:** if a template already exists (case-insensitive detection under `.github/`, repo root, `docs/`, or a file in `.github/PULL_REQUEST_TEMPLATE/`), `init` skips writing a template and prints the privacy checklist block to paste manually.

**Manifest:** `{ "schemaVersion": 1, "files": [ { "path", "kind": "owned", "version", "sha256" } ] }`. v1 only creates **`owned`** entries; **`managed`** is reserved for v2 `sync`. Re-runs merge new entries for files created in that run (sorted by `path`).

## Releasing

**What ships:** the npm package is CLI-only (`nodrift` binary). The tarball includes `dist/`, `templates/`, `LICENSE`, `LICENSES/`, and `README.md` (see `files` in `package.json`). There is no public JavaScript API (`exports` exposes only `./package.json`).

**Before the first release:** a maintainer must create `@didi-build/nodrift` on npm and configure [trusted publishing](https://docs.npmjs.com/trusted-publishers) for this repo with workflow file **`release.yml`**. That one-time bootstrap is outside this repository’s automation.

**Routine release:**

1. Open a PR that bumps `version` in `package.json` (and `package-lock.json` if needed) and updates [CHANGELOG.md](./CHANGELOG.md).
2. Merge to `main`, then tag the merge commit on `main` as `vX.Y.Z` (tag must match `package.json`).
3. The **Release** workflow runs `npm run check`, `npm run package:check`, then **`npm stage publish`** via OIDC (no npm token in GitHub).
4. Approve the staged release with 2FA: `npm stage list @didi-build/nodrift`, `npm stage view <id>`, `npm stage approve <id>`, or the **Staged Packages** tab on [npmjs.com](https://www.npmjs.com/).
5. **Verify provenance** on the npm package page (Provenance badge) and in a temp project: `npm install @didi-build/nodrift@X.Y.Z` then `npm audit signatures`. If staged publishes do not carry provenance, use direct `npm publish` behind a GitHub environment approval instead (see ADR 0003 amendment 23).

`npm run package:check` (also in CI) packs the package, enforces the file allowlist and size budget, installs the tarball in a temp project, and smoke-tests the installed `nodrift` bin (`init` / `check`).

## Commands (development)

```bash
npm install          # install deps and git hooks (prepare)
npm run build        # compile CLI to dist/
npm run check        # format, lint, typecheck, test, secrets, placeholders, attribution
npm run package:check   # pack allowlist + install smoke test (CI / before release)
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
