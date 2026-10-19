-- Metadata-only delivery ledger for lead sink messages (no visitor PII).
CREATE TABLE IF NOT EXISTS lead_delivery_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  sink_id TEXT NOT NULL,
  sink_kind TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('record', 'append')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  error_code TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  retry_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  UNIQUE (lead_id, sink_id, phase)
);

CREATE INDEX IF NOT EXISTS idx_lead_delivery_ledger_lead_id ON lead_delivery_ledger (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_delivery_ledger_status_next ON lead_delivery_ledger (status, next_attempt_at);
