# Bootstrap runbook

Launchpad-derived repositories run the **Bootstrap** workflow automatically. It replaces manual `init-project` and `repo-settings` steps for repos that have a bootstrap token configured.

## What it does

On eligible runs, Bootstrap:

1. Runs `scripts/init-project.mjs` with slug, display name, purpose, and **owner** derived from the repository name, `LAUNCHPAD_REPO_DESCRIPTION` (set from the GitHub repository description in the workflow), and `GITHUB_REPOSITORY_OWNER` (`didi-build` → `Didi Build`; other owners use the login as-is). Only when the repo is still a template checkout. **When Bootstrap will actually run init**, the GitHub repository description must be set; if it is empty, the plan step fails with a clear message (skipped runs and already-initialized repos are not affected).
2. Commits the result to the default branch as `github-actions[bot]` (including removing Launchpad example code and setting `package.json` `description` from the repo purpose).
3. Runs `npm run repo-settings -- --apply` then `-- --verify` using the bootstrap token (branch protection, auto-merge, delete head branches, squash-only merges).

The workflow does **not** run `npm ci` or install dependencies in the bootstrap job (the PAT is stored in `.git/config` by `actions/checkout`; no install scripts may run in that job).

## Plan table

| Repository state | Trigger                                | `init` | `settings` |
| ---------------- | -------------------------------------- | ------ | ---------- |
| Not initialized  | First `push` to `main`                 | yes    | yes        |
| Initialized      | `push` to `main`, first attempt        | no     | no         |
| Initialized      | **Re-run jobs** (attempt &gt; 1)       | no     | yes        |
| Initialized      | **Run workflow** (`workflow_dispatch`) | no     | yes        |

The template repository `didi-build/launchpad` skips Bootstrap entirely.

## `BOOTSTRAP_TOKEN` (organization secret)

For **didi-build** derived **public** repositories:

1. Create a **fine-grained PAT** (or classic PAT with equivalent scopes) with:
   - **Repository access:** all repositories that use the template (or the org).
   - **Permissions:** Administration (read/write), Contents (read/write), Issues (read/write) — as required by `repo-settings` and pushing the init commit.
2. In the **didi-build** org, add an Actions secret named `BOOTSTRAP_TOKEN` with the PAT value.
3. Share the secret with **all repositories** (or the repos that are created from Launchpad).

Derived repos created outside **didi-build** do not receive this org secret. They either:

- Add a **repository** secret also named `BOOTSTRAP_TOKEN`, or
- Follow the [manual fallback](#manual-fallback) in [new-project-checklist.md](../new-project-checklist.md).

### Expiry and rotation

1. Generate a new PAT before the old one expires.
2. Update the org (or repo) secret `BOOTSTRAP_TOKEN`.
3. On a derived repo, use **Actions → Bootstrap → Run workflow** (or re-run a failed bootstrap job) to re-apply settings if needed.

### Retry a failed run

- **Re-run jobs** on a failed Bootstrap workflow run (re-applies **settings** only if init already completed). Re-run reuses the original event payload, so it does **not** pick up a repository description you added after the failure.
- **Run workflow** manually from the Actions tab to retry with the **current** repository description and settings (use this after fixing a missing description).

### Missing repository description

If Bootstrap fails in the plan step with _This repository has no description_:

1. Open the repository on GitHub, edit **About** (repository description), and save a one-line summary.
2. In **Actions → Bootstrap**, choose **Run workflow** (not **Re-run jobs**) so the workflow sees the updated description.

### Troubleshooting: settings failed with invalid header

If Bootstrap fails during `repo-settings` with `net/http: invalid header field value for "Authorization"` (or the job log only shows `repo-settings --apply failed.`):

1. The org or repo secret `BOOTSTRAP_TOKEN` likely contains a stray newline, carriage return, or other invisible character (often pasted with a trailing line break).
2. Open **Organization settings → Secrets and variables → Actions** (or the repository’s **Settings → Secrets and variables → Actions**), edit `BOOTSTRAP_TOKEN`, and paste the PAT again with **no quotes** and **no trailing whitespace**.
3. Save the secret, then on the failed workflow run choose **Re-run jobs** (or **Run workflow** from the Bootstrap action).

Bootstrap trims leading/trailing whitespace when possible and warns in the log; tokens with newlines or spaces **inside** the value are rejected before init or push run.

## Manual fallback

If Bootstrap skips because no token is configured:

```bash
npm install
npm run init-project -- <slug> "<display name>" ["<purpose>"] ["<owner>"]
npm run repo-settings -- --apply
npm run repo-settings -- --verify
```

Set `GH_TOKEN` to a PAT with sufficient permissions when running `repo-settings` locally or in CI.

## Security note

`BOOTSTRAP_TOKEN` is an org (or repo) secret **readable by any workflow** in repositories the secret is shared with. Keep permissions minimal, rotate on schedule, and never reference or log the secret outside `.github/workflows/bootstrap.yml` (see `npm run secret-usage` and [AGENTS.md](../../AGENTS.md)).

## GitHub REST API used by `repo-settings`

Bootstrap does not call the API directly; `scripts/repo-settings.mjs` uses the GitHub CLI (`gh api`), which maps to these REST endpoints:

| Operation                 | `gh` usage | REST endpoint                                                                                                                                                              |
| ------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read branch protection    | `GET`      | [Get branch protection](https://docs.github.com/en/rest/branches/branch-protection#get-branch-protection) — `GET /repos/{owner}/{repo}/branches/{branch}/protection`       |
| Apply branch protection   | `PUT`      | [Update branch protection](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection) — `PUT /repos/{owner}/{repo}/branches/{branch}/protection` |
| Read repository settings  | `GET`      | [Get a repository](https://docs.github.com/en/rest/repos/repos#get-a-repository) — `GET /repos/{owner}/{repo}`                                                             |
| Patch repository settings | `PATCH`    | [Update a repository](https://docs.github.com/en/rest/repos/repos#update-a-repository) — `PATCH /repos/{owner}/{repo}`                                                     |

Label creation for Dependabot auto-merge uses the Issues API via `gh` helpers in `scripts/lib/dependabot-label.mjs` ([Create a label](https://docs.github.com/en/rest/issues/labels#create-a-label) — `POST /repos/{owner}/{repo}/labels`).
