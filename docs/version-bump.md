# How a version bump works

Nodrift is a **versioned npm package** (`@didi-build/nodrift`). Consumer repos pin an **exact** version in `devDependencies` and adopt updates through Dependabot (or a manual bump).

## What you get from a bump

| Bump      | Typical contents                                                                           | Effect on your repo                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Patch** | Bug fixes, clearer diagnostics                                                             | Same behaviour; messages may improve. CI should stay green without map changes.                                                                     |
| **Minor** | New checks, new optional `init` scaffolds, optional config keys                            | **New checks can fail CI** until you fix the map or Wrangler coverage. Read [CHANGELOG.md](../CHANGELOG.md) for each check and how to fix failures. |
| **Major** | Breaking map `schema_version`, removed/renamed commands, flags, config keys, or exit codes | You must migrate the data map (and any config) per the changelog. Package major **N** only supports map **`schema_version` N**.                     |

During the `0.x` line, minors may still introduce breaking behaviour; treat every upgrade as reviewable. **`1.0.0`** is planned only after [we-met has adopted nodrift](https://linear.app/didi-build/issue/DIDI-651).

## Owned vs managed files

`nodrift init` records every file it creates in **`.nodrift/manifest.json`** with:

- **`kind: "owned"`** — human-edited; `init` never overwrites. v1 only creates owned files.
- **`kind: "managed"`** — reserved for v2 **`nodrift sync`**, which will regenerate template-owned files from the package.

A version bump **does not rewrite your owned files**. It updates the **CLI and checks** in `node_modules`. In v2, `sync` will refresh managed templates when the kit version changes; until then, review template changes in the changelog and edit owned scaffolds yourself if you want newer wording.

## Recommended workflow

1. Dependabot (or you) opens a PR that bumps `@didi-build/nodrift` to the new exact version.
2. CI runs `nodrift check` (and your usual tests).
3. If the bump is **minor** and adds a check, fix failures using the messages and [CHANGELOG.md](../CHANGELOG.md), then merge.
4. Use auto-merge only when your repo is configured to wait for green CI (so `main` does not merge with a failing new check).

## Deprecations

Features slated for removal warn for **one minor release** before they are removed in the next major (or the next minor during `0.x`).

## Maintainers

Publishing a new version is described in the README [Releasing](../README.md#releasing) section (tag on `main`, staged publish via OIDC).
