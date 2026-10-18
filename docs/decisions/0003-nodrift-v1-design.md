# 0003. Nodrift v1 design

- **Status:** proposed
- **Date:** 2026-10-18

## Context

[Nodrift](https://github.com/didi-build/nodrift) is a small versioned npm CLI that keeps privacy documentation aligned with application code. Consumer repos (for example [`didi-build/we-met`](https://github.com/didi-build/we-met)) maintain a machine-readable **data map** and Cloudflare Worker configuration; without automated checks, maps drift from migrations, bindings, and logging behavior.

Planning and the locked v1 decisions live in Linear [DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown) (parent) and [DIDI-649](https://linear.app/didi-build/issue/DIDI-649/nodrift-versioned-package-check-and-init-that-keeps-privacy-docs-from) (comments). This ADR records those decisions for implementers and agents. Status stays **proposed** until a maintainer accepts it in review; merge to `main` does not by itself flip status — the maintainer sets **accepted** when satisfied.

## Decision summary

| #   | Topic                   | Decision (short)                                                                                             |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | v1 scope                | CLI with `check` and `init` only; three `check` rule groups (see below).                                     |
| 2   | Map format              | YAML list of entries; D1 rows use `table`/`column`; other stores use dotted `id` prefixes.                   |
| 3   | Schema for `check`      | Replay SQL migrations in order into in-memory SQLite via `node:sqlite`; compare effective schema to the map. |
| 4   | Naming and distribution | Publish `@didi-build/nodrift`; CLI binary `nodrift`; reserve unscoped `nodrift` on npm.                      |
| 5   | Config                  | Repo-root `nodrift.jsonc` (JSONC) with paths, `d1_tables`, and check toggles.                                |
| 6   | Versioning              | Semver on the package; guardrail behavior changes ship only via version bumps in consumer repos.             |
| 7   | `init` rules            | Idempotent scaffold of map, runbooks, and PR checklist; never overwrite without `--force`.                   |

---

## 1. v1 scope

### Decision

**In scope for v1**

- npm package `@didi-build/nodrift` exposing a `nodrift` CLI with subcommands **`check`** and **`init`** only.
- **`check`** runs three rule groups (exit non-zero on any failure; human-readable diagnostics on stderr):
  1. **Map vs D1 schema** — For each D1 database configured in `d1_tables`, apply all SQL migration files in lexical order to an empty in-memory database, then verify every map entry that documents a D1 `table`/`column` exists in the effective schema, and every such column in the effective schema is documented in the map (see [stale map entries](#open-details-resolved-in-this-adr)).
  2. **Map vs Wrangler bindings** — Parse the configured `wrangler.jsonc` (including `previews` overrides when present) and ensure data-bearing bindings are reflected in the map and in `d1_tables` where applicable (see [Check 2 binding types](#open-details-resolved-in-this-adr)).
  3. **Repository guardrails** — Static checks bundled with the package version: **PII-in-logs** (forbidden logging of configured field names / patterns in application source) and **no third-party scripts** (no `<script src="https://…">` or equivalent loaders in configured frontend paths).
- **`init`** — One-time, idempotent scaffolding (see [§7](#7-init-rules)).
- **Runtime** — Node.js only; no Cloudflare API calls in v1.

**Explicitly out of scope for v1 (v2 or later)**

- `sync` and any auto-regeneration of managed files (see [v2 `sync` sketch](#v2-sync-sketch)).
- Live D1/R2/Queue inspection, CSP/header verification, email-provider detection, or vendor retention API calls.
- Auto-fix, PR comments, GitHub Actions action wrapper (consumers invoke the CLI from their own CI).
- Map editing UI, VS Code extension, non-Cloudflare platforms.

### Reasons

- A single versioned package lets guardrails improve everywhere when teams bump `nodrift`, matching the goal in [DIDI-649](https://linear.app/didi-build/issue/DIDI-649/nodrift-versioned-package-check-and-init-that-keeps-privacy-docs-from).
- Splitting `check` into schema, infrastructure, and code guardrails matches how [`we-met` audit findings](https://github.com/didi-build/we-met/blob/main/docs/privacy/audit-findings.md) were discovered (migrations vs map, wrangler vs map, code/config gaps).
- Deferring `sync` avoids blocking v1 on template ownership and merge semantics while the [v2 sketch](#v2-sync-sketch) keeps the map format evolvable.

### Alternatives rejected

- **Per-repo copy-paste scripts** — No central rollout; fixes do not reach all repos.
- **Documentation-only checklist** — Does not catch drift before merge.
- **ESLint-only rules** — Cannot validate YAML maps or SQL migration order.
- **v1 includes `sync`** — Too much product surface before `check` proves value.

---

## 2. Map format

### Decision

- **Default path:** `docs/privacy/data-map.yml` (overridable in `nodrift.jsonc`).
- **Encoding:** UTF-8 YAML.
- **Shape:** A document with optional `map_version: 1` and a top-level **`entries`** array (sequence of mapping objects). v1 also accepts a bare YAML sequence at the root for hand-authored files (equivalent to `entries`).
- **Entry fields (v1):**

  | Field         | Required     | Notes                                                                                              |
  | ------------- | ------------ | -------------------------------------------------------------------------------------------------- |
  | `id`          | yes          | Stable dotted identifier (`accounts.email`, `queue.visitor_followup`, `storage.r2.card_photo`, …). |
  | `whose`       | yes          | Data-subject category (`card_owner`, `visitor`, `operational`, …).                                 |
  | `data`        | yes          | Short description of what is stored or processed.                                                  |
  | `purpose`     | yes          | Why it exists.                                                                                     |
  | `storage`     | yes          | Human label (`D1`, `R2 (BINDING_NAME)`, `Cloudflare Queue (name)`, …).                             |
  | `retention`   | yes          | Policy text or `unknown`.                                                                          |
  | `who_can_see` | yes          | Audience (string or list).                                                                         |
  | `source`      | yes          | Repo path, URL, or ADR reference.                                                                  |
  | `verified`    | yes          | `true` / `false` — `check` warns on `false` but does not fail solely for that in v1.               |
  | `table`       | if D1 column | SQL table name for D1 column rows.                                                                 |
  | `column`      | if D1 column | SQL column name.                                                                                   |
  | `processors`  | no           | List of third-party processors.                                                                    |
  | `notes`       | no           | Free text (for example PLACEHOLDER rows).                                                          |

- **D1 column rows** must include `table` and `column` and should use `storage: D1` (or include `D1` in the storage string). **Non-tabular** stores (queues, R2, logs, email, browser, cookies) use dotted `id` values without `table`/`column`, following the [`we-met` reference map](https://github.com/didi-build/we-met/blob/main/docs/privacy/data-map.yml).

### Reasons

- YAML matches how privacy editors already work in consumer repos and diff cleanly in PRs.
- Column-level D1 entries match PIPEDA-style inventory granularity used in production.
- Dotted `id` namespaces keep non-D1 stores in one file without forcing fake tables.

### Alternatives rejected

- **JSON map** — Harder for humans; no comments without JSONC everywhere.
- **Markdown tables** — Poor machine validation; awkward for 90+ rows.
- **Database as source of truth** — Wrong direction (docs must follow code).

---

## 3. How `check` reads the schema

### Decision

- For each item in `nodrift.jsonc` → `d1_tables`, `check`:
  1. Resolves `migrations_dir` (default `migrations` relative to repo root).
  2. Collects `*.sql` files in that directory, sorted lexicographically by filename (same convention as Wrangler `migrations_dir`).
  3. Creates an in-memory SQLite database using Node’s built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) (`DatabaseSync`).
  4. Executes each migration file in order (full file contents, multiple statements allowed).
  5. Reads the **effective** schema via `sqlite_master` and `PRAGMA table_info` for user tables.
- **Comparison rules:**
  - Every map entry with both `table` and `column` for that D1 database must exist in the effective schema.
  - Every user table column in the effective schema must appear in the map for that database (see stale entries).
  - Ignores SQLite internal tables; ignores tables created only in migration files that were later dropped (effective schema after full replay), matching the note in [`we-met` audit findings](https://github.com/didi-build/we-met/blob/main/docs/privacy/audit-findings.md).

### Reasons

- Replay matches Wrangler/D1 migration semantics without network access.
- In-memory SQLite is fast enough for CI and matches “effective schema after all migrations” called out in privacy audits.
- `node:sqlite` avoids native addons (`better-sqlite3`) and keeps the dependency budget at two parsers.

### Alternatives rejected

- **Regex-parse `CREATE TABLE` per file** — Fails on renames, drops, and multi-statement migrations.
- **Live D1 query** — Needs credentials; non-deterministic; slow in CI.
- **Third-party SQLite binding** — Violates dependency budget and Node version story.

---

## 4. Naming and distribution

### Decision

- **npm package name:** `@didi-build/nodrift` (scoped public package).
- **CLI binary name:** `nodrift` (via `package.json` `"bin"`).
- **GitHub:** `https://github.com/didi-build/nodrift`.
- **Registry:** npm public registry when the publish ticket removes `"private": true`.
- **Unscoped name:** Reserve the npm package name **`nodrift`** (empty placeholder or org-held) so third parties cannot squat the obvious install name; document reservation in the maintainer runbook. Consumers install with `npm install -D @didi-build/nodrift` and invoke `nodrift` via `npx` or `node_modules/.bin`.

### Reasons

- Scoped naming matches other `@didi-build/*` packages and clarifies ownership.
- Reserving `nodrift` prevents confusion and typosquatting on the product name.
- A single package keeps versioning and release simple.

### Alternatives rejected

- **Primary publish as unscoped `nodrift`** — Squatting risk; scope already identifies the org.
- **Split `@didi-build/nodrift-check` and `…-init`** — Two version bumps and APIs for one tool.

---

## 5. Config

### Decision

- **File:** `nodrift.jsonc` at the repository root (JSONC — comments allowed).
- **Schema version:** `"config_version": 1`.
- **v1 fields:**

  | Field        | Purpose                                                   |
  | ------------ | --------------------------------------------------------- |
  | `data_map`   | Path to YAML map (default `docs/privacy/data-map.yml`).   |
  | `wrangler`   | Path to `wrangler.jsonc` (default `wrangler.jsonc`).      |
  | `d1_tables`  | Object keyed by **Wrangler D1 binding name** (see below). |
  | `checks`     | Optional toggles per rule group (default all enabled).    |
  | `guardrails` | Paths/globs for PII-in-logs and third-party-script scans. |
  | `init`       | Optional output paths for `init` scaffolds.               |

- **`d1_tables` entry shape:**

  ```jsonc
  {
    "WE_MET_DB": {
      "migrations_dir": "migrations",
    },
  }
  ```

  - **Key:** `binding` string from `d1_databases[].binding` in `wrangler.jsonc` (and preview overrides).
  - **`migrations_dir`:** Directory of SQL migrations for Check 1 for that database (required).

- Ship a JSON Schema from the package (for example `nodrift.schema.json`) and recommend a `# yaml-language-server` / JSONC editor hint in docs.

### Reasons

- JSONC matches `wrangler.jsonc` and allows commented examples.
- Binding-keyed `d1_tables` links Wrangler config to migration replay without guessing database UUIDs.
- One config file keeps repo setup obvious in CI (`nodrift check` with no flags when cwd is repo root).

### Alternatives rejected

- **All config in `package.json`** — Pollutes app metadata; bad for non-Node repos.
- **YAML config** — Third YAML dialect in the same toolchain (map is already YAML).

---

## 6. Versioning

### Decision

- **`@didi-build/nodrift` uses SemVer.**
- **Patch:** bug fixes, clearer diagnostics, no new failures on unchanged repos.
- **Minor:** new checks that may fail existing repos, new optional `init` outputs, backward-compatible config keys.
- **Major:** breaking changes to map entry requirements, config shape, or CLI exit-code contract.
- **Consumer rollout:** Each repo pins `nodrift` in `devDependencies` (exact version once published — see dependency pin rule in `AGENTS.md`). Bumping the pin is how teams adopt new guardrails.
- **`map_version`:** Independent integer in the YAML map; bump when entry required fields change. `check` rejects unknown `map_version` with a clear error.

### Reasons

- Semver is npm’s contract; teams need predictable CI when upgrading.
- Separating `map_version` from package version lets map syntax evolve without conflating tool and data format.

### Alternatives rejected

- **Calendar versioning** — Unfamiliar on npm; poor fit for libraries.
- **Floating `latest` in CI** — Breaks repos without intentional review.

---

## 7. `init` rules

### Decision

- **`nodrift init`** is **idempotent**: create missing scaffold files; **do not modify** existing files unless the user passes **`--force`** (per-path or global — implementation detail left to the init ticket, but overwrite always requires an explicit flag).
- **Default outputs (v1):**
  - `docs/privacy/data-map.yml` — commented skeleton with one example D1 row and one non-D1 row.
  - `docs/runbooks/` — privacy runbook skeleton (for example account deletion placeholder).
  - `.github/` — PR checklist snippet or `pull_request_template` section for privacy/data-map review.
- **Header comment** on generated files: nodrift version and link to docs (no secrets).
- **Launchpad:** Future change to `init-project` in Launchpad calls `nodrift init` after template substitution (separate ticket); v1 `init` must work on existing repos with no Launchpad placeholders.
- **`init` does not** run `check`, edit `wrangler.jsonc`, or write `nodrift.jsonc` unless missing (may write a commented default `nodrift.jsonc` if absent).

### Reasons

- Idempotency makes `init` safe in Bootstrap and manual runs.
- Scaffolds match the three artifacts teams need before `check` is meaningful.
- `--force` protects hand-edited privacy docs.

### Alternatives rejected

- **Always overwrite scaffolds** — Destructive on real repos.
- **Interactive wizard only** — Blocks CI and Launchpad automation.

---

## v2 `sync` sketch

Not implemented in v1; included so the map and config formats stay compatible.

- **`nodrift.jsonc`** gains a `managed` section listing files nodrift may regenerate (paths + template ids).
- **`nodrift sync`** (v2) regenerates only those files from templates shipped in the package, stamping a `nodrift-generated` footer with package version and checksum.
- **`nodrift check`** (v2) fails if a managed file’s stamp is older than the template version or content drifts from the template without a fresh sync.
- **v1 `sync`:** Reserved — see [open details](#open-details-resolved-in-this-adr).

---

## Open details resolved in this ADR

| Detail                                                | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Minimum Node for `node:sqlite` without a CLI flag** | **`engines.node`: `>=22.13.0`**. Node [22.13.0](https://nodejs.org/en/blog/release/v22.13.0) unflagged `node:sqlite` (still experimental). Verified in this repo’s environment: `import('node:sqlite')` succeeds on **v22.14.0** with no `--experimental-sqlite` and no `NODE_OPTIONS`. Versions **22.5.0–22.12.x** require `--experimental-sqlite` and are not supported.                                                                                           |
| **Suppress `ExperimentalWarning`?**                   | **Yes.** `check` (and only those code paths that open SQLite) filters `process.emitWarning` once at startup to hide the SQLite experimental warning, so CI logs stay readable. Other warnings are not suppressed. Revisit when Node marks `node:sqlite` stable without warning.                                                                                                                                                                                      |
| **Check 2: binding types that are data stores**       | Treat as in scope for map coverage: `d1_databases`, `r2_buckets`, `queues` producers/consumers, `kv_namespaces`, and `durable_objects` bindings. **Not** treated as data stores for Check 2: `services`, `images`, `assets`, `vars`, `ratelimits`, `routes`, `observability`, `compatibility_flags`, `migrations_dir` alone. Each in-scope binding must have at least one map entry whose `storage` or `id` references the binding name, bucket name, or queue name. |
| **D1 binding ↔ `d1_tables`**                          | `d1_tables` keys **must equal** `d1_databases[].binding` values from the parsed wrangler config (including `previews` blocks). Check 2 fails if a D1 binding is missing from `d1_tables` or if `d1_tables` lists a binding absent from wrangler. Check 1 uses `migrations_dir` from the matching `d1_tables` entry.                                                                                                                                                  |
| **Stale map entries (schema drift)**                  | **Error** — a map `table`/`column` for a configured D1 database that is not in the effective schema after migration replay fails `check`. An effective column missing from the map is also an **error**.                                                                                                                                                                                                                                                             |
| **`sync` in v1**                                      | Subcommand exists in help as **reserved**. Invoking `nodrift sync` prints that sync ships in v2 and exits with code **2** (usage / not available).                                                                                                                                                                                                                                                                                                                   |
| **Reserve unscoped `nodrift` on npm**                 | **Yes** — maintainer reserves the name; implementation repos use `@didi-build/nodrift` only.                                                                                                                                                                                                                                                                                                                                                                         |

---

## Dependency budget

Production `dependencies` (exact-pinned in `package.json` when implementation lands):

| Package                                                      | Version pin policy | Dependencies of its own                       | Justification                                                                                            |
| ------------------------------------------------------------ | ------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`yaml`](https://www.npmjs.com/package/yaml) (eemeli)        | Exact patch pin    | **None** (`npm view yaml dependencies` empty) | Parse and stringify `data-map.yml` with YAML 1.2 and good error messages.                                |
| [`jsonc-parser`](https://www.npmjs.com/package/jsonc-parser) | Exact patch pin    | **None**                                      | Parse `wrangler.jsonc` and `nodrift.jsonc` with comments and trailing commas without a full JSON5 stack. |

**Rules:** no other runtime dependencies in v1; no transitive dependency chains (verify on each bump); pin exact versions in `package.json` and let Dependabot propose patch updates.

---

## Consequences

- Implementation tickets can land `check` and `init` in any order once this ADR is **accepted**, but **no production code before acceptance** (see `AGENTS.md`).
- Consumer repos need Node **22.13+** in CI for `check`.
- First consumer integration (for example `we-met`) will need a `nodrift.jsonc` and may surface map gaps — expected.
- v2 `sync` can extend config without breaking v1 maps that omit `managed`.

## References

- [DIDI-659 — nodrift build v1 parent decisions](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown)
- [DIDI-649 — planning record](https://linear.app/didi-build/issue/DIDI-649/nodrift-versioned-package-check-and-init-that-keeps-privacy-docs-from)
- [DIDI-660 — repo setup (this ADR)](https://linear.app/didi-build/issue/DIDI-660/nodrift-repo-setup-adr-mit-license-package-metadata)
