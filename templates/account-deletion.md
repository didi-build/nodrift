# Account deletion runbook

Use this runbook when a user requests account deletion or when you must remove personal data from production systems.

## 1. Verify the request

- Confirm identity and authorization to delete the account.
- Record the request ID and timestamp.

## 2. Map data to delete

- Use `docs/privacy/data-map.yml` to list tables, objects, and queues that hold the user's data.
- Note dependencies (foreign keys, async jobs, backups).

## 3. Delete or anonymize

- Apply application deletion flows in dependency order.
- Remove or overwrite personal fields; retain only what law or fraud prevention requires.

## 4. Verify completion

- Re-run `nodrift check` after schema or binding changes.
- Spot-check logs and support tools for leftover identifiers.

## 5. Close the request

- Document what was deleted, when, and by whom.
- Update subprocessors if vendor deletion tickets were opened.
