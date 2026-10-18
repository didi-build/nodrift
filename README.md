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
- `d1_tables` — one entry per D1 table with `defaults` (shared fields) and `columns` (every column by name; use `id: {}` when a column inherits defaults).
- `other_items` — non-tabular stores (R2, queues, cookies, …) with a unique `id` and optional `binding:` for Wrangler names.

**Rules (validation)**

- Unknown keys at any level are **errors** (with a “did you mean …?” hint when the key is one typo away).
- Allowed column / default fields: `whose`, `data`, `purpose`, `storage`, `processors`, `retention`, `who_can_see`, `source`, `verified`, `notes`. Types are checked (`processors` is a list of strings; `verified` is boolean).
- **Merge:** per field; a column override replaces the default entirely (lists are replaced, not appended).
- `whose` is a free-form string; only `operational` and `TODO` are reserved.
- **Personal-data tables:** if any column is not `operational`, `defaults` must **not** set `whose`, and every column must declare `whose` (bare `{}` fails with **needs `whose`**). Purely operational tables may use `whose: operational` in `defaults`.
- Personal-data columns (and all `other_items`) need `data`, `purpose`, `processors`, and `retention` after merge. `processors` may be `[]` (“no processors”). `whose: TODO` yields only a **classify this** finding until classified.

**Loader API** (`src/`)

| Function                                    | Role                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `parseDataMap(text, filePath)`              | Parse + validate; returns `{ map, findings }` or `{ fatal }`.                         |
| `expandDataMap(map)`                        | Effective entry per D1 column and per `other_item`, with source paths for each field. |
| `parseSubprocessors(text, filePath)`        | Light shape check for `subprocessors.yml`.                                            |
| `loadDataMapFile` / `loadSubprocessorsFile` | Thin `readFileSync` wrappers around the parsers.                                      |

**Exit mapping (for the CLI)**

| Kind         | Examples                                                                 | CLI exit code |
| ------------ | ------------------------------------------------------------------------ | ------------- |
| **Fatal**    | Unreadable file, YAML syntax error, unsupported newer `schema_version`   | `2`           |
| **Findings** | Unknown keys, missing `whose`, personal-data requirements, duplicate ids | `1`           |

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
