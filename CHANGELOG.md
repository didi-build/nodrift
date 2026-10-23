# Changelog

All notable changes to `@didi-build/nodrift` are documented here. Consumers should read this on every version bump.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows [SemVer](https://semver.org/) (see README **Versioning** and [docs/version-bump.md](./docs/version-bump.md)).

## [Unreleased]

## [0.2.0] - 2026-10-23

### Added

- **Check 2 multi-config discovery:** `nodrift check` walks from the configured `wrangler` search root (default `.`) for `wrangler.json` and `wrangler.jsonc` (one file per directory; see **Changed** above when both exist), skipping `node_modules` and common build or VCS directories. Nested worker configs are included. Each in-scope binding finding names the config file it came from.
- **`wranglerConfigs` in `nodrift.config.json`:** optional list of Wrangler JSON/JSONC paths (relative to the repo root). When set, discovery is skipped and only those files are checked.
- **Skipped `wrangler.toml` warnings:** when discovery finds at least one `wrangler.json` or `wrangler.jsonc` and also finds `wrangler.toml`, `nodrift check` prints `wrangler.toml is unsupported, skipped: <path>` on stdout for each TOML file (not a failure).

### Changed

- **Check 2 JSON vs JSONC precedence:** when a directory has both `wrangler.json` and `wrangler.jsonc`, `nodrift check` uses `wrangler.json` (Wrangler order) and prints `wrangler.jsonc skipped: <path>` on stdout.
- **`wrangler` config key (Check 2):** now the **search root** for discovering Wrangler JSON/JSONC configs, not a single directory with one resolved file. A search root that points at one directory still checks that directory's config; discovery additionally finds nested configs. The library `checkDataStoresVsMap({ wranglerDir })` option is unchanged.
- **`wrangler.toml` during discovery:** if the search finds no JSON/JSONC configs but does find `wrangler.toml`, Check 2 exits `2` (same fatal as amendment 7). Warnings apply only when JSON/JSONC configs are also present.
- **`wranglerConfigs`:** when the key is present in `nodrift.config.json` (including `[]`), discovery is skipped; `wrangler` is ignored with a stdout warning when it is not `.`.
- Check 2 binding diagnostics may include findings from more than one Wrangler config in the same run.

## [0.1.0] - 2026-10-22

First published npm release for v1: `init`, `check`, and reserved `sync`.

### Added

- **`nodrift init`** — idempotent scaffolding of owned privacy files (never overwrites). Writes `.nodrift/manifest.json` when it creates at least one file.
- **`nodrift check`** — runs map validation, Check 1 (map vs migrations), Check 2 (Wrangler data-store bindings vs map), and optional `subprocessors.yml` validation when that file exists.
- **Unsupported Wrangler configs (ADR 0003, [DIDI-712](https://linear.app/didi-build/issue/DIDI-712))** — `check` fails with exit code `1` on multiple `d1_databases` in the same Wrangler section and on any `durable_objects.bindings` entry instead of passing silently.
- **`nodrift sync`** — reserved; prints that sync is not available in v1 and exits `2`.
- **`nodrift.config.json`** — optional overrides for `map`, `subprocessors`, `migrations`, `wrangler`, and `ignoreTables`.
- Grouped data map format (`schema_version: 1`, `d1_tables`, `other_items`).

### Checks and how to fix failures

#### Map loader (`data-map.yml`)

Validation runs before Check 1 and Check 2. Any loader finding fails `check` with exit code **`1`** (fatals such as unreadable YAML use **`2`**).

| Code / situation                                    | Meaning                                                                                           | How to fix                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `unsupported_schema_version`                        | Map `schema_version` is newer than this package supports                                          | Upgrade `@didi-build/nodrift` to a release that supports that schema, or lower `schema_version` if you upgraded by mistake. |
| `invalid_schema_version` / `missing_schema_version` | `schema_version` missing or not a supported integer                                               | Set `schema_version: 1` at the top of the file.                                                                             |
| `unknown_key`                                       | Typo or unsupported field                                                                         | Remove the key or fix the spelling (messages may suggest a nearby key).                                                     |
| `column_needs_whose`                                | Personal-data table column with bare `{}`                                                         | Set `whose` on that column (not only in `defaults`).                                                                        |
| `defaults_whose_on_personal_table`                  | `defaults.whose` set on a table that holds personal data                                          | Remove `whose` from `defaults`; set `whose` on each column.                                                                 |
| `whose_todo`                                        | Column or item still `whose: TODO`                                                                | Classify the data (`operational`, `card_owner`, etc.).                                                                      |
| `missing_required_field` / `empty_required_string`  | Personal-data column or `other_items` row missing `data`, `purpose`, `processors`, or `retention` | Fill in the required fields after merge with `defaults`.                                                                    |
| `duplicate_other_item_id`                           | Two `other_items` share the same `id`                                                             | Use unique `id` values.                                                                                                     |
| `table_not_in_map`                                  | Schema has a table not listed under `d1_tables`                                                   | Add the table and every column (paste-ready snippet in the message).                                                        |
| `column_not_in_map`                                 | Schema has a column not listed under that table                                                   | Add the column (`{}` on operational tables, `{ whose: TODO }` on personal-data tables until classified).                    |
| `table_not_in_schema` / `column_not_in_schema`      | Map declares a table or column that migrations do not create                                      | Remove stale map entries or add a migration.                                                                                |

#### Check 1 — map vs migrations

Replays `migrations/*.sql` in memory and compares to `d1_tables`.

| Code / situation                               | Meaning                                       | How to fix                                                                                                  |
| ---------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Migration apply failure                        | A `.sql` file does not apply cleanly          | Fix the migration SQL; the message names the file and error.                                                |
| No migrations but map has D1 tables            | Migrations path wrong or empty                | Fix `migrations` in `nodrift.config.json` or add migration files.                                           |
| `table_not_in_map` / `column_not_in_map`       | Drift: schema ahead of map                    | Same as loader comparison rows above.                                                                       |
| `table_not_in_schema` / `column_not_in_schema` | Drift: map ahead of schema                    | Remove stale entries or add migrations.                                                                     |
| FTS5 / shadow tables                           | Extra tables from virtual FTS (e.g. `*_data`) | Add those table names to `ignoreTables` in config, or run CI on Node **22.16+** if migrations require FTS5. |

Ignored by default: `sqlite_*`, `_cf_*`, `d1_migrations`, plus `ignoreTables`.

#### Check 2 — data stores vs map

Discovers every `wrangler.json` and `wrangler.jsonc` under the configured `wrangler` search root (default repo root), or checks only the paths in `wranglerConfigs` when that key is set. TOML-only trees exit `2`; otherwise discovered `wrangler.toml` files print a stdout warning and are skipped.

| Code / situation                          | Meaning                                                                        | How to fix                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `binding_not_in_map`                      | D1, R2, KV, queue producer, or Images binding not on any `other_items.binding` | Add an `other_items` row listing the binding name (snippet in the message).                |
| `multiple_d1_databases`                   | More than one `d1_databases` entry in one Wrangler section                     | Remove extra D1 bindings until nodrift supports multiple databases per section (ADR 0003). |
| `durable_objects`                         | Any `durable_objects.bindings` entry                                           | Remove Durable Object bindings until nodrift supports them (ADR 0003).                     |
| `wrangler.toml` only (legacy API)         | Single-directory `wranglerDir` check with only TOML                            | Use `wrangler.jsonc` or `wrangler.json`.                                                   |
| Map lists `binding:` but no Wrangler file | Bindings declared without a matching config                                    | Add Wrangler config(s) or remove unused `binding:` entries.                                |

Not checked in v1: **stale `binding:` entries** — a map name that matches no Wrangler binding is not reported (Check 2 only checks Wrangler bindings against the map, not the reverse); also outside vendors, `services`, `assets`, `vars`, `ratelimits`, and `routes`. **Durable Objects** and **multiple D1 databases per section** fail `check` as unsupported configs (see ADR 0003).

#### Subprocessors (`subprocessors.yml`)

Validated only when the configured file **exists**.

| Code / situation                       | Meaning                                                         | How to fix                                                                                    |
| -------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `missing_subprocessors` / shape errors | Root must be a list under `subprocessors` with `schema_version` | Match the scaffold from `init` and required fields per row (`name`, `purpose`, `data`, etc.). |
| `duplicate_subprocessor_name`          | Two entries share `name`                                        | Use unique names.                                                                             |

### Exit codes (`nodrift check`)

- **`0`** — pass (including “nothing to check” when there is no migrations/map D1 work or no Wrangler bindings to compare).
- **`1`** — findings (map, schema, bindings, subprocessors).
- **`2`** — cannot run (bad config, unreadable files, failed migration replay, corrupt manifest during `init`, etc.).
