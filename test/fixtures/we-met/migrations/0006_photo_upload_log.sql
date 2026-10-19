-- Photo upload rate cap (ADR 0025 phase 3). Expand-only safe for shared non-prod lint.

CREATE TABLE IF NOT EXISTS photo_upload_log (
  account_id TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_upload_log_account_uploaded
  ON photo_upload_log (account_id, uploaded_at);
