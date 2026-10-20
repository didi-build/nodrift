# Breach response runbook

Use this runbook when you suspect or confirm unauthorized access to personal data.

## 1. Triage

- Assign an incident lead and record the start time (UTC).
- Classify severity (customer impact, data types, active attacker).
- Preserve evidence before destructive changes (logs, snapshots, access records).

## 2. Contain

- Stop ongoing harm (revoke credentials, block abusive traffic, disable affected features).
- Document every containment action with timestamp and approver.

## 3. Assess

- Determine what data was involved using `docs/privacy/data-map.yml` and system logs.
- Open a breach record using `docs/privacy/breach-record-template.md`.

## 4. Notify

- Involve legal/privacy owners before external notification.
- Follow regulatory and contractual timelines for your jurisdictions.

## 5. Recover and review

- Restore service safely; verify integrity.
- Schedule a post-incident review and track remediation in Linear.
