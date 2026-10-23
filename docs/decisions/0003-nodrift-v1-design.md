# 0003. Nodrift v1 design

- **Status:** accepted
- **Date:** 2026-10-18

## Context

[Nodrift](https://github.com/didi-build/nodrift) is a small versioned npm CLI that keeps privacy documentation aligned with application code. Consumer repos (for example [`didi-build/we-met`](https://github.com/didi-build/we-met)) maintain a machine-readable **data map** and Cloudflare Worker configuration; without automated checks, maps drift from migrations, bindings, and operational reality.

Planning and the locked v1 decisions live in Linear [DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown) (parent, source of truth) and [DIDI-649](https://linear.app/didi-build/issue/DIDI-649/nodrift-versioned-package-check-and-init-that-keeps-privacy-docs-from) (comments). This ADR records those decisions for implementers and agents. It is **accepted** when merged to `main`; implementation tickets start after that merge ([DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown) requires no code before the ADR is merged).

## Decision summary

| #   | Topic                   | Decision (short)                                                                                                     |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | v1 scope                | CLI with `check` and `init` only; **two** `check` rules (map vs migrations; data stores vs map).                     |
| 2   | Map format              | `schema_version: 1`; `d1_tables` grouped by table with defaults and column overrides; flat `other_items` for non-D1. |
| 3   | Schema for `check`      | Replay migrations into in-memory SQLite via `node:sqlite`; swappable schema reader; compare to `d1_tables`.          |
| 4   | Naming and distribution | `@didi-build/nodrift`, binary `nodrift`, MIT, OIDC publish with provenance; reserve unscoped `nodrift` on npm.       |
| 5   | Config                  | Zero config by default; optional strict `nodrift.config.json` with five override keys.                               |
| 6   | Versioning              | Semver; package major **N** reads map `schema_version` **N**; ship `0.x` until we-met adopts, then `1.0.0`.          |
| 7   | `init` rules            | Idempotent scaffold via `.nodrift/manifest.json`; no `--force`; only `--dry-run`.                                    |

---

## 1. v1 scope

### Decision

**In scope for v1**

- npm package `@didi-build/nodrift` exposing a `nodrift` CLI with subcommands **`check`** and **`init`** only (the name **`sync`** is reserved; see [open details](#open-details-resolved-in-this-adr)).
- **`check`** runs **exactly two** checks (human-readable diagnostics on stderr; see [exit codes](#exit-codes) in §5):
  1. **Map vs migrations** — Apply SQL migration files in order to an empty in-memory database and verify every column in `d1_tables` exists in the effective schema and every user column in the effective schema is declared in the map (see [§3](#3-how-check-reads-the-schema) and [stale map entries](#open-details-resolved-in-this-adr)).
  2. **Data stores vs map** — Parse the configured Wrangler config and verify every in-scope data-store binding is covered by `other_items` via explicit `binding:` fields (see [Check 2 binding types](#open-details-resolved-in-this-adr)).
- **`init`** — One-time, idempotent scaffolding (see [§7](#7-init-rules)).
- **Runtime** — Node.js only; no Cloudflare API calls and no GitHub API calls in v1.

**Frozen v1 contract** (additive changes only within a `schema_version`; breaking map changes require a new package major):

| Surface    | v1 contract                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Map        | `schema_version: 1`; grouped `d1_tables` and `other_items` (see [§2](#2-map-format)).              |
| Commands   | `nodrift init`, `nodrift check` (plus reserved `nodrift sync` stub).                               |
| Config     | Zero-config defaults; optional `nodrift.config.json` with at most five keys (see [§5](#5-config)). |
| Exit codes | `0` pass, `1` problems found, `2` nodrift misconfigured or cannot run.                             |

**Room for v2 `sync`** (v1 must not block this):

- Every file `init` creates is recorded in **`.nodrift/manifest.json`** with the kit version and a **`kind`**: `owned` or `managed` (v1 only creates **`owned`** files).
- The **`sync`** command name is reserved in v1.
- **`check`** has an extension point to flag a **managed** file as out of date (compare manifest kit version and content hash).
- **`sync`** (v2) may regenerate **only** files marked **`managed`** in the manifest; it never touches **`owned`** files.

**`init` creates** (never overwrites existing paths):

- Breach runbook and breach record template
- Deletion runbook skeleton
- `docs/privacy/subprocessors.yml`
- `SECURITY.md`
- PR checklist (or checklist block when an existing PR template is present)
- Starter `docs/privacy/data-map.yml` when absent (see [§7](#7-init-rules))

**Check 2 limits:** A newly added outside vendor (for example an email provider) is **not** detected by Check 2; it remains a **human check** in the PR checklist.

**Explicitly out of scope for v1 (v2 or later)**

- **`sync`** and managed-file regeneration (see [v2 `sync` sketch](#v2-sync-sketch)).
- **PII-in-logs** and **no-third-party-scripts** repository guardrails.
- Policy generation from the map, **`wrangler.toml`** support (JSON/JSONC only in v1), and **`--json`** CLI output.
- Live D1/R2/Queue inspection, CSP/header verification, or vendor retention API calls.
- Auto-fix, PR comments, GitHub Actions action wrapper (consumers invoke the CLI from their own CI).
- Map editing UI, VS Code extension, non-Cloudflare platforms.

### Reasons

- Two automated checks cover the highest-frequency drift (schema and bindings) without boiling the ocean; code-style guardrails move to v2 with `sync` and richer policy tooling ([DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown)).
- A frozen contract lets consumer repos pin an exact package version with predictable CI behavior.
- Manifest + `owned`/`managed` kinds keep v1 `init` simple while making v2 `sync` a straight extension.

### Alternatives rejected

- **Per-repo copy-paste scripts** — No central rollout; fixes do not reach all repos.
- **Documentation-only checklist** — Does not catch migration or binding drift before merge.
- **Three check groups in v1 (schema, bindings, code guardrails)** — Deferred; guardrails ship in v2 ([DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown)).
- **v1 includes `sync`** — Too much surface before `check` proves value.

---

## 2. Map format

### Decision

- **Default path:** `docs/privacy/data-map.yml` (overridable via `nodrift.config.json` → `map`).
- **Encoding:** UTF-8 YAML.
- **Top level:**
  - **`schema_version: 1`** (required). A newer version is refused with an **upgrade nodrift** message. Unknown top-level keys are **errors**. Changes within a version are **additive only** (new optional fields).
  - **`d1_tables`:** object keyed by **SQL table name**. Each table has:
    - **`defaults`** — shared fields for columns that inherit them (`whose`, `data`, `purpose`, `processors`, `retention`, `who_can_see`, `source`, `verified`, `notes`, …).
    - **`columns`** — every column **listed by name**. A column that inherits all applicable fields from `defaults` is written as **`id: {}`**.
  - **`other_items`:** flat list of non-tabular items (queues, R2, KV, Images, …). An item may include **`binding:`** naming one or more Wrangler binding identifiers (one item may list several bindings, for example three rate limiters).

**Personal-data rule**

- If a table holds **any** personal data, **`defaults` must not set `whose`**. Every column in that table must declare **`whose`** explicitly.
- A bare `{}` on a column in such a table **fails validation** with a message that the column **needs `whose`**.
- Purely operational tables may keep an operational default (`whose: operational`, etc.) so most columns are only their name.

**Required fields**

- **Personal-data columns** (and all `other_items`): `whose`, `data`, `purpose`, `processors`, `retention` (plus `binding` where applicable for Check 2).
- **Operational columns** need only be **declared** (name under `columns`; inherited metadata from `defaults` is enough).

**Carry-over fields**

- `verified`, `source`, and `notes` behave as in existing maps. **`verified: false`** means the fact depends on a vendor or mailbox, or has not been confirmed (`check` may warn but does not fail solely on `verified: false` in v1).

**Adoption**

- [`we-met`](https://github.com/didi-build/we-met)’s existing flat per-column map is converted **once** at adoption ([DIDI-651](https://linear.app/didi-build/issue/DIDI-651)); the loader supports **only** this grouped format in v1.

**Illustrative example** (from [DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown); abbreviated). Illustrative values only; paths and descriptions are not taken from a real repository.

```yaml
schema_version: 1

d1_tables:
  sessions:
    defaults:
      whose: operational
      storage: D1
      processors: [Cloudflare]
      retention: until session expiry or logout
      who_can_see: operator
      source: src/app-auth/sessions.ts
      verified: true
    columns:
      token_hash: {}
      account_id: {}
      created_at: {}
      expires_at: {}

  accounts:
    defaults:
      storage: D1
      processors: [Cloudflare]
      who_can_see: operator
      source: src/app-auth/accounts.ts
    columns:
      id:
        whose: operational
        data: Account UUID
        purpose: primary key
        retention: until account tombstone
        verified: true
      email:
        whose: card_owner
        data: Google account email (normalized)
        purpose: sign-in and visitor communications
        retention: until account tombstone (blanked on delete)
        verified: true
      status:
        whose: operational
        data: Account lifecycle status
        purpose: access control
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
    source: src/queues/visitor-followup.ts
    verified: true
  - id: storage.card_photo
    binding: [WE_MET_ASSETS]
    whose: card_owner
    data: Card photo bytes in R2
    purpose: card image display
    processors: [Cloudflare]
    retention: until card deletion
    source: src/storage/card-photos.ts
    verified: true
```

### Reasons

- Grouping by table matches how engineers think about D1 schema and shrinks real maps: we-met’s flat file is **1,178** lines; the grouped shape is about **538**, and **45 of 70** columns need nothing but their name ([DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown)).
- Table-level `defaults` with per-column overrides keeps PIPEDA-style inventory without repeating `storage: D1` on every row.
- `other_items` + explicit `binding:` links Wrangler bindings to map rows without pretending queues are SQL tables.

### Alternatives rejected

- **Flat per-column list** (`entries` / one row per column everywhere) — Verbose; rejected for v1 in favor of grouped `d1_tables` ([DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown)).
- **JSON map** — Harder for humans; no comments without JSONC everywhere.
- **Markdown tables** — Poor machine validation.
- **Database as source of truth** — Wrong direction (docs must follow code).
- **`map_version` separate from package semver** — Replaced by **`schema_version` tied to package major** (see [§6](#6-versioning)).

---

## 3. How `check` reads the schema

### Decision

- Migration replay and schema extraction sit behind **one small swappable “schema reader” module** (v1 uses `node:sqlite`; the seam allows a future `sql.js` backend without rewriting checks).
- **Check 1** (map vs migrations):
  1. Resolve the migrations directory (default `migrations/` at repo root, or `nodrift.config.json` → `migrations`).
  2. Collect `*.sql` files, sorted **lexicographically by filename** (same convention as Wrangler `migrations_dir`).
  3. Create an in-memory SQLite database using Node’s built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) (`DatabaseSync`).
  4. Execute each migration file in order (full file contents; multiple statements allowed).
  5. If a migration **fails to apply**, **`check` fails** and reports the **migration file name** and the **SQL error** (never skip silently).
  6. Read the **effective** schema via `sqlite_master` and **`PRAGMA table_info`** for user tables.
- **Ignored tables** (not compared to the map): `sqlite_*`, `_cf_*`, and **`d1_migrations`**.
- **Comparison:** Every column declared under `d1_tables` must exist in the effective schema; every user column in the effective schema must appear in `d1_tables` ([stale entries](#open-details-resolved-in-this-adr)).
- **v1 assumption:** One migrations directory and one **`d1_tables`** section in the map (repos with **multiple D1 databases** are not supported in v1; see [Proposed changes for maintainer review](#proposed-changes-for-maintainer-review)).
- **Validation evidence:** On **2026-10-18**, this approach was run against [`we-met`](https://github.com/didi-build/we-met)’s real migrations (**11 tables**, **70 columns**), matching the grouped map target in [DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown).

### Reasons

- Replay matches Wrangler/D1 migration semantics without network access.
- In-memory SQLite is fast enough for CI and reflects the effective schema after all migrations.
- A swappable reader avoids locking the project to one SQLite embedding forever.
- `node:sqlite` avoids native addons and keeps the dependency budget at two parsers.

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
- **License:** **MIT**, copyright **Didi Build**; keep Launchpad attribution in `README.md` and `LICENSES/launchpad-MIT.txt` (compatible MIT licenses).
- **Publishing:** npm **trusted publishing (OIDC)** from GitHub Actions with **provenance**, behind a **manual approval** gate (no long-lived npm token stored in the repo). The publish ticket verifies OIDC for this scoped package; the **first publish** may still need a one-time manual npm step.
- **Registry:** npm public registry when the publish ticket removes `"private": true`.
- **Unscoped name:** Reserve the npm package name **`nodrift`** (maintainer-held placeholder) so third parties cannot squat the obvious install name. Consumers install with `npm install -D @didi-build/nodrift` and invoke `nodrift` via `npx` or `node_modules/.bin`.

### Reasons

- The scope identifies the owning organization.
- OIDC + provenance matches org supply-chain expectations without stored tokens.
- Reserving `nodrift` prevents confusion and typosquatting on the product name.

### Alternatives rejected

- **Primary publish as unscoped `nodrift`** — Squatting risk; scope already identifies the org.
- **Stored npm token in CI** — Rejected in favor of OIDC trusted publishing ([DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown)).
- **Split `@didi-build/nodrift-check` and `…-init`** — Two version bumps and APIs for one tool.

---

## 5. Config

### Decision

**Zero config by default** (paths match [`we-met`](https://github.com/didi-build/we-met) so adoption needs no config file):

| Artifact        | Default path / rule                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Data map        | `docs/privacy/data-map.yml`                                                                                        |
| Subprocessors   | `docs/privacy/subprocessors.yml`                                                                                   |
| SQL migrations  | `migrations/*.sql` (sorted by filename)                                                                            |
| Wrangler config | Recursive discovery under the `wrangler` search root (see [amendment 25](#amendment-25-didi-800)); JSON/JSONC only |

**Optional overrides:** `nodrift.config.json` at the repository root (**strict JSON**, no comments). Unknown keys are **errors**. **`--config <path>`** selects another file.

**Config keys (see [amendment 25](#amendment-25-didi-800) for Check 2 discovery):**

| Key               | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `map`             | Path to `data-map.yml`                                          |
| `subprocessors`   | Path to `subprocessors.yml`                                     |
| `migrations`      | Migrations directory                                            |
| `wrangler`        | Check 2 search root for discovering Wrangler JSON/JSONC configs |
| `wranglerConfigs` | Optional explicit Wrangler JSON/JSONC paths (skips discovery)   |
| `ignoreTables`    | Extra table names excluded from Check 1                         |

Which Wrangler binding types count as data stores for Check 2 is **built in** (not configurable in v1).

**Exit codes**

| Code | Meaning                                      |
| ---- | -------------------------------------------- |
| `0`  | Pass                                         |
| `1`  | Problems found (map/schema/binding mismatch) |
| `2`  | Nodrift misconfigured or cannot run          |

**Output:** Human-readable text only in v1 (no `--json`).

### Reasons

- Defaults match the first consumer repo; most teams never need a config file.
- Strict JSON for overrides avoids a second JSONC dialect beside Wrangler.
- Five keys keep validation and documentation bounded.

### Alternatives rejected

- **`nodrift.jsonc` / `config_version`** — Rejected; v1 uses optional `nodrift.config.json` only ([DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown)).
- **Per-binding `d1_tables` config** — Rejected for v1; one migrations dir and one map section (see [Proposed changes](#proposed-changes-for-maintainer-review)).
- **`checks`, `guardrails`, `init` config keys** — Out of scope; checks are not toggled in v1.
- **All config in `package.json`** — Pollutes app metadata.

---

## 6. Versioning

### Decision

- **`@didi-build/nodrift` uses SemVer.**
- **Patch:** bug fixes, clearer diagnostics, no new failures on unchanged repos.
- **Minor:** new checks that may fail existing repos, new optional `init` outputs, backward-compatible config keys. **New checks in a minor release run as normal failing checks** — the failure appears on the Dependabot upgrade PR with the fix named in the message and `CHANGELOG.md`; auto-merge waits for green, so `main` does not go red.
- **Major:** a breaking change — a `schema_version` change, or removing or renaming a command, flag, config key, or exit code — including breaking changes to the map contract or config shape.
- **`schema_version` ↔ package major:** Package major **N** reads and writes map **`schema_version` N** only. A breaking map schema change ships as a **new package major** with migration notes in `CHANGELOG.md`.
- **Release numbering:** Build and publish **`0.x`** during development; publish **`1.0.0`** only after [`we-met` has adopted nodrift](https://linear.app/didi-build/issue/DIDI-651) ([DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown)).
- **Deprecations:** Warn for **one minor** release before removal.
- **Changelog:** Every release updates `CHANGELOG.md`, including each new check and how to fix a failure.
- **Consumer rollout:** Repos pin an **exact** `nodrift` version in `devDependencies` (see `AGENTS.md`). Bumping the pin is how teams adopt new checks.

### Reasons

- Semver is npm’s contract; teams need predictable CI when upgrading.
- Tying `schema_version` to package major avoids two competing version integers.
- Exact pins plus Dependabot PRs make guardrail rollouts reviewable.

### Alternatives rejected

- **Independent `map_version`** — Rejected; superseded by `schema_version` aligned to package major ([DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown)).
- **Calendar versioning** — Unfamiliar on npm.
- **Floating `latest` in CI** — Breaks repos without intentional review.

---

## 7. `init` rules

### Decision

- **`nodrift init`** is **idempotent**: create missing scaffold files; **never overwrite** an existing file. **No `--force`.** To regenerate a file, **delete it** and run `init` again.
- **CLI flag:** **`--dry-run`** only (print what would be created).
- **Manifest:** **`.nodrift/manifest.json`** records, for each file `init` created, **`path`**, **`kind`** (`owned` or `managed`), **`kitVersion`**, and a **hash of the original content**. v1 only writes **`owned`** files. **No header comments** inside generated files.
- **Starter map:** If the repo has migrations but no `data-map.yml`, scaffold **`d1_tables`** from the effective schema (every table and column) with **`whose: TODO`**. **`check` fails** on any `TODO` with a **classify this** message.
- **Existing PR template:** If `.github/pull_request_template.md` (or equivalent) already exists, **`init` skips writing** a template and **prints** the privacy checklist block to paste manually. **`init` never edits a file it did not create.**
- **`init` does not** touch CI workflows, call GitHub, or write a config file.
- **Empty repo:** A new project with **no migrations** gets scaffolds; **`check` passes** with a **nothing to check** outcome for Check 1.

**Default outputs (v1)** — see [§1](#1-v1-scope) for the full list (breach runbooks, deletion runbook skeleton, `subprocessors.yml`, `SECURITY.md`, PR checklist, starter map).

**Launchpad:** A future Launchpad `init-project` change may call `nodrift init` after template substitution (separate ticket).

### Reasons

- Idempotency makes `init` safe in Bootstrap and on brownfield repos.
- Manifest + hashes enable v2 stale detection without embedding version stamps in file bodies.
- Migration-derived `whose: TODO` forces explicit classification before merge.

### Alternatives rejected

- **`--force` overwrite** — Rejected; delete-and-re-run is explicit ([DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown)).
- **Header comments with kit version in every file** — Rejected; manifest holds version metadata.
- **Always overwrite scaffolds** — Destructive on real repos.

---

## v2 `sync` sketch

Not implemented in v1; included so v1 `init` and the map format stay compatible.

- **`.nodrift/manifest.json`** lists every nodrift-created file with **`kind`**: `owned` (human-edited; `init` only) or `managed` (template-owned).
- **`nodrift sync` (v2)** regenerates **only** files marked **`managed`**, updating manifest **`kitVersion`** and content **hash**.
- **`nodrift check` (v2+)** flags a **managed** file as **stale** when its on-disk content does not match the hash for the recorded kit version (or when a newer kit template exists — exact rule in the v2 ADR).
- **`sync` never touches `owned` files.**
- **v1:** `nodrift sync` is reserved — see [open details](#open-details-resolved-in-this-adr).

---

## Open details resolved in this ADR

| Detail                                                | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Minimum Node for `node:sqlite` without a CLI flag** | **`engines.node`: `>=22.13.0`**. See [Node floor evidence](#node-floor-evidence) below.                                                                                                                                                                                                                                                                                                                                                                                        |
| **Suppress `ExperimentalWarning`?**                   | **Yes.** `check` filters `process.emitWarning` (or equivalent) on SQLite code paths so CI logs stay readable. Other warnings are not suppressed. Revisit when Node marks `node:sqlite` stable without warning.                                                                                                                                                                                                                                                                 |
| **Check 2: binding types that are data stores**       | **In scope:** D1 (`d1_databases`), R2 (`r2_buckets`), KV (`kv_namespaces`), **queue producers** (`queues.producers`), and **Images** (`images.binding`). **Matching:** each in-scope binding must appear on at least one `other_items` entry’s **`binding:`** list (explicit names; no fuzzy match on `storage` or `id` text). One `other_items` row may list **multiple** bindings. **Not** in the locked v1 list: `services`, `assets`, `vars`, `ratelimits`, `routes`, etc. |
| **D1 vs map (v1)**                                    | **One** migrations directory (default `migrations/`, or `migrations` config key) and **one** `d1_tables` section. No per-database config in v1.                                                                                                                                                                                                                                                                                                                                |
| **Stale map entries (schema drift)**                  | **Error** — a `d1_tables` column missing from the effective schema fails `check`; an effective column missing from the map also **errors**.                                                                                                                                                                                                                                                                                                                                    |
| **`sync` in v1**                                      | Invoking `nodrift sync` prints that **sync is not available in v1** and exits **`2`**.                                                                                                                                                                                                                                                                                                                                                                                         |
| **Reserve unscoped `nodrift` on npm**                 | **Yes** — maintainer reserves the name; implementation repos use `@didi-build/nodrift` only.                                                                                                                                                                                                                                                                                                                                                                                   |

### Node floor evidence

| Node version | `import('node:sqlite')` without `--experimental-sqlite` | Notes                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22.5.1       | **Fail** (`ERR_UNKNOWN_BUILTIN_MODULE`)                 | Tested 2026-10-18 on Linux x64 with `npx -y node@22.5.1` ([DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown))                 |
| 22.12.0      | **Fail** (`ERR_UNKNOWN_BUILTIN_MODULE`)                 | Tested 2026-10-18 on Linux x64 with `npx -y node@22.12.0 -e "import('node:sqlite').then(()=>console.log('OK')).catch(e=>console.log('FAIL',e.code))"` → `FAIL ERR_UNKNOWN_BUILTIN_MODULE` |
| 22.13.0      | **OK** (prints `ExperimentalWarning`)                   | Tested 2026-10-18 on Linux x64 with `npx -y node@22.13.0 -e "import('node:sqlite').then(()=>console.log('OK')).catch(e=>console.log('FAIL',e.code))"` → `OK`                              |
| 22.13.1      | **OK** (prints `ExperimentalWarning`)                   | Tested 2026-10-18 on Linux x64 with `npx -y node@22.13.1` ([DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown))                |
| 22.14.0      | **OK** (prints `ExperimentalWarning`)                   | Tested 2026-10-18 on Linux x64 with `npx -y node@22.14.0`; matches this environment’s default Node                                                                                        |

Node [22.13.0](https://nodejs.org/en/blog/release/v22.13.0) unflagged `node:sqlite` (still experimental).

---

## Dependency budget

Production `dependencies` (exact-pinned in `package.json` when implementation lands):

| Package                                                      | Version pin policy | Dependencies of its own                       | Justification                                                                                                               |
| ------------------------------------------------------------ | ------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [`yaml`](https://www.npmjs.com/package/yaml) (eemeli)        | Exact patch pin    | **None** (`npm view yaml dependencies` empty) | Parse and stringify `data-map.yml` and `subprocessors.yml` with YAML 1.2 and good errors.                                   |
| [`jsonc-parser`](https://www.npmjs.com/package/jsonc-parser) | Exact patch pin    | **None**                                      | Parse `wrangler.jsonc` / `wrangler.json` with comments and trailing commas. `nodrift.config.json` uses strict `JSON.parse`. |

**Rules:** no other runtime dependencies in v1; no transitive dependency chains (verify on each bump); pin exact versions in `package.json` and let Dependabot propose patch updates.

---

## Proposed changes for maintainer review

These are **not** locked in [DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown). The ADR keeps the locked decision above; discuss before changing.

### Decision ([DIDI-702](https://linear.app/didi-build/issue/DIDI-702))

Decided by Diadem on **2026-10-22** (recorded on [DIDI-702](https://linear.app/didi-build/issue/DIDI-702) when marked Done):

- **Multiple D1 databases** — **Deferred.** No current repo uses more than one D1 database per Wrangler section.
- **Durable Objects in Check 2** — **Deferred.** No current repo uses Durable Object bindings in Wrangler.
- **Until support ships** — `check` must **fail loudly** on either configuration instead of passing silently. Implementation: [DIDI-712](https://linear.app/didi-build/issue/DIDI-712).

| Topic                          | Locked v1 decision                       | Proposal                                                                                            | Status (DIDI-702)         |
| ------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- |
| **Multiple D1 databases**      | One migrations dir + one `d1_tables` map | Add first-class multi-database support (per-binding migrations + map sections) in v1.1 or v2.       | **Deferred (2026-10-22)** |
| **Durable Objects in Check 2** | D1, R2, KV, queues, Images only          | Also require map coverage for `durable_objects` bindings with explicit `binding:` on `other_items`. | **Deferred (2026-10-22)** |

**Interim rule (v1, per DIDI-702):** `nodrift check` **fails** (exit `1`) when the Wrangler config declares **more than one** `d1_databases` entry in any single section (top level, `env.<name>`, or `previews`), or **any** `durable_objects` binding in those sections. Diagnostics name the binding(s) and Wrangler file, state that the configuration is **not supported yet by nodrift**, and link this section. There is **no bypass flag** in v1.

---

## Amendments

Approved by the maintainer on **2026-10-19** (recorded here for implementers; the locked §3 text above is unchanged until a follow-up ADR edit):

1. **Check 1 column discovery** — Read columns with **`PRAGMA table_xinfo`** instead of **`PRAGMA table_info`**, so generated (virtual and stored) columns are included in the comparison.
2. **Failed migration** — If a migration **fails to apply**, Check 1 is a **`fatal`** (CLI exit `2`), not a finding.
3. **Missing migrations** — If the map declares **any D1 table** but there are **no** `*.sql` migration files (or the migrations directory is missing), Check 1 is a **`fatal`**. **`nothing_to_check`** applies only when **both** the map has no D1 tables **and** there are no migrations to replay.
4. **Known limitation (FTS5 on older Node)** — Migrations that create FTS5 virtual tables require **Node 22.16 or newer** for in-memory replay with `node:sqlite`. On **22.13 through 22.15**, replay fails with `no such module: fts5`. `engines.node` remains `>=22.13.0`; consumers with FTS5 migrations should run Check 1 on Node 22.16+.
5. **Check 2 section scan** — Parse the **top level**, every **`env.<name>`** block, and **`previews`**, taking the **union by binding name** (case-sensitive); each binding remembers every section that declares it.
6. **Check 2 `multiple_d1_databases`** — More than one `d1_databases` entry in a **single** Wrangler section is a **`multiple_d1_databases`** finding (v1 supports one D1 database per section for Check 1 alignment).
7. **Check 2 Wrangler file presence** — _(Superseded for CLI discovery by [amendment 25](#amendment-25-didi-800); still applies to the legacy library `wranglerDir` API.)_ **`wrangler.toml` only** is a **fatal** (exit `2`). **Missing** search root / `wranglerDir`, a **non-directory** path, or an unreadable **search root** is a **fatal** (`check the \`wrangler\` path`). A readable tree with **no** `wrangler.jsonc`/`wrangler.json` is **`nothing_to_check`** only when **no** `other_items` entry has a **`binding:`**; if the map references bindings but no Wrangler JSON/JSONC file is found, that is a **fatal** listing those binding names.
8. **Check 2 stale bindings** — **No** reverse check in v1 (map `binding:` values with no Wrangler counterpart do not fail Check 2).

Approved by the maintainer on **2026-10-21** (CLI and `init` implementation, [DIDI-671](https://linear.app/didi-build/issue/DIDI-671)):

9. **Build and `bin`** — TypeScript compiles `src/` to `dist/` (`tsconfig.build.json`, `npm run build`). The CLI entry is `dist/cli.js` with `#!/usr/bin/env node` via `package.json` `"bin": { "nodrift": "dist/cli.js" }`. Publishing uses an allowlisted `files` field, `package:check`, and staged OIDC release workflow `release.yml` (see [DIDI-673](https://linear.app/didi-build/issue/DIDI-673)).
10. **`wrangler` config key** — _(Superseded for CLI Check 2 by [amendment 25](#amendment-25-didi-800); legacy library `wranglerDir` still uses single-directory resolution.)_ The `wrangler` value was a **directory** path (default `.`) with one resolved config file per directory.
11. **`check` flow** — Load and validate the map once as a gate (fatal → exit `2`, findings → exit `1`, neither check runs). Optionally validate `subprocessors.yml` when the file exists. Run Check 1 and Check 2 independently; aggregate fatals and findings for exit codes.
12. **CLI output streams** — `check` diagnostics go to **stdout**; usage and config errors go to **stderr**. The CLI sets `process.exitCode` and drains stdout/stderr before exit (no `process.exit` immediately after writes).
13. **`init` outputs** — Default owned paths: configured `map` and `subprocessors`, `docs/runbooks/breach-response.md`, `docs/privacy/breach-record-template.md`, `docs/runbooks/account-deletion.md`, `SECURITY.md`, optional `.github/pull_request_template.md`, and `.nodrift/manifest.json`.
14. **Starter map without migrations** — `schema_version: 1`, `d1_tables: {}`, `other_items: []`.
15. **PR template detection** — Case-insensitive match for `.github/pull_request_template.md`, root `pull_request_template.md`, `docs/pull_request_template.md`, or any **file** under `.github/PULL_REQUEST_TEMPLATE/` (an empty directory does not count). When a template already exists, `init` prints the privacy checklist block instead of writing a template.
16. **Manifest** — `.nodrift/manifest.json` shape: `{ "schemaVersion": 1, "files": [ { "path", "kind": "owned", "version", "sha256" } ] }`. Written or merged only when at least one owned file is created; corrupt or unsupported manifests fail before any write.
17. **Templates** — Package-root `templates/` plain files (LF); `init` copies them without substitution. Breach templates record PIPEDA breach-record and reporting facts with the Canada Gazette SOR/2018-64 s. 6(1) link ([gazette](https://gazette.gc.ca/rp-pr/p2/2018/2018-04-18/html/sor-dors64-eng.html)), OPC breach guidance ([gd_pb_201810](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/privacy-breaches-at-your-business/gd_pb_201810/)), and breach report form ([report-a-privacy-breach-at-your-business](https://www.priv.gc.ca/en/report-a-concern/report-a-privacy-breach-at-your-organization/report-a-privacy-breach-at-your-business/)); each template ends with a one-line skeleton / not-legal-advice note.

Approved by the maintainer on **2026-10-21** (publish pipeline, [DIDI-673](https://linear.app/didi-build/issue/DIDI-673)):

18. **CLI-only npm package (0.x)** — There is no public JavaScript API. `exports` lists only `./package.json`; there is no `main`, `types`, or shipped `.d.ts`. The frozen contract is commands, config keys, exit codes, and map schema.
19. **`files` allowlist and `package:check`** — `files` is an allowlist (`dist`, `templates`, `LICENSE`, `LICENSES`, `README.md`). `npm run package:check` packs the tarball, asserts every path is allowed and required files are present (including all `templates/*`), enforces a packed-size budget (~2× measured size), and smoke-tests an installed copy (`init` / `check`). It runs in CI and before staging a release; it is not part of `npm run check` (network install).
20. **Staged publishing (approval)** — [DIDI-659](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown) decision 4’s “manual approval environment” is implemented as **npm staged publishing**: CI runs `npm stage publish` over OIDC; the version is **not** public until a maintainer approves with 2FA (`npm stage approve` or npmjs.com). A tag push alone cannot ship a release without that approval.
21. **Trusted-publisher bootstrap** — The first release needs a one-time maintainer bootstrap: create the package on npm, stage a throwaway version, run `npm trust github … --allow-stage-publish`, reject the throwaway stage, then tag real releases. A newly created trusted-publisher configuration **expires** if its first successful publish does not complete within **2 days** ([npm trusted publishers](https://docs.npmjs.com/trusted-publishers), “Trusted publisher configuration expiry”), so run the trust command, tag, and approve in the same working session. The docs do not say whether a staged but unapproved release counts as that first publish, so do not rely on staging alone.
22. **`release.yml` invariants** — Workflow file name **`release.yml`**; trigger **only** `push` of tags `v*`; top-level `permissions: { contents: read }`; single `release` job with `id-token: write`, repo guard `didi-build/nodrift`, no caches; **Node 24** in the release job only (`engines.node` stays `>=22.13.0`); npm **≥ 11.15.0** before `npm ci`; tag must equal `v` + `package.json` version and sit on `origin/main`; then `npm ci`, `npm run check`, `npm run package:check`, **`npm stage publish`** (never `npm publish`); no `NODE_AUTH_TOKEN`, `NPM_TOKEN`, or `secrets.*`.
23. **Provenance** — Trusted publishing from GitHub Actions generates provenance automatically. **Do not** set `publishConfig.provenance` (it breaks the maintainer’s manual bootstrap from a laptop). Verify provenance on the **first** approved release (Provenance badge on npm, `npm audit signatures` in a temp install). If staged publishes do not carry provenance, fall back to direct `npm publish` behind a GitHub **environment** approval gate.

Approved by the maintainer on **2026-10-22** ([DIDI-702](https://linear.app/didi-build/issue/DIDI-702); implemented in [DIDI-712](https://linear.app/didi-build/issue/DIDI-712)):

24. **Unsupported Wrangler configurations** — Per the [DIDI-702 decision](#decision-didi-702): both proposals in [Proposed changes](#proposed-changes-for-maintainer-review) are **deferred** (no current repo uses either). Until first-class support ships, `check` fails with `multiple_d1_databases` or `durable_objects` findings (exit `1`) instead of passing silently; messages name bindings, say **not supported yet by nodrift**, and link ADR 0003. No opt-out in v1.

Approved by the maintainer on **2026-10-23** ([DIDI-800](https://linear.app/didi-build/issue/DIDI-800/nodrift-check-2-scan-every-wrangler-config-in-the-repo-not-just-the)):

25. **Check 2 multi-config discovery (0.2.0)** — CLI Check 2 walks the configured **`wrangler` search root** (default `.`) recursively for `wrangler.jsonc` and `wrangler.json` (`wrangler.jsonc` preferred when both exist in the same directory). Symbolic link directories are not followed; config paths are deduped by real path. Skipped directory names include `node_modules`, `dist`, `build`, `coverage`, `test-results`, `.git`, `.svn`, `.hg`, `.next`, `.open-next`, `.cache`, `.turbo`, `.vercel`, `.husky`, `.nodrift`, `.wrangler`, `out`, `.output`, and `.svelte-kit`. Optional **`wranglerConfigs`** lists explicit JSON/JSONC paths relative to the repo root; when that key is present (including `[]`), discovery is skipped and **`wrangler` is ignored** (stdout warning when `wrangler` is not `.`). **`wrangler.toml`:** if discovery finds **no** JSON/JSONC config anywhere under the search root but does find `wrangler.toml`, Check 2 is a **fatal** (exit `2`) with the same message as amendment 7. If at least one JSON/JSONC config is found, each `wrangler.toml` path prints `wrangler.toml is unsupported, skipped: <path>` on stdout (warning only). The library `checkDataStoresVsMap({ wranglerDir })` entry point keeps single-directory semantics from amendments 7 and 10.

---

## Consequences

- Implementation tickets can land `check` and `init` in any order once this ADR is merged to `main`; **no production code before that merge** (see `AGENTS.md`).
- Consumer repos need Node **22.13+** in CI for `check`.
- First consumer integration ([`we-met`](https://github.com/didi-build/we-met), [DIDI-651](https://linear.app/didi-build/issue/DIDI-651)) needs its map **converted to the grouped format**, not a `nodrift.jsonc` config file.
- v2 `sync` can add `managed` kinds and regeneration without breaking v1 maps or manifests that only contain `owned` files.

## References

- [DIDI-659 — nodrift build v1 parent decisions](https://linear.app/didi-build/issue/DIDI-659/nodrift-build-v1-parent-decisions-and-build-breakdown)
- [DIDI-649 — planning record](https://linear.app/didi-build/issue/DIDI-649/nodrift-versioned-package-check-and-init-that-keeps-privacy-docs-from)
- [DIDI-660 — repo setup (this ADR)](https://linear.app/didi-build/issue/DIDI-660/nodrift-repo-setup-adr-mit-license-package-metadata)
- [DIDI-651 — we-met adoption](https://linear.app/didi-build/issue/DIDI-651)
