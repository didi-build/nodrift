-- Cards, hostname routing, and lead sinks (step 1 schema).
-- Edited in place (2026-10-11): links_json and copy_json replace footer_link_json /
-- exchange_copy_json. Migration 0001 has NOT been applied to any remote D1; safe to
-- reshape before first db:migrate:remote or production deploy.
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  variant TEXT NOT NULL CHECK (variant IN ('green', 'mono')),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  photo_key TEXT,
  links_json TEXT NOT NULL,
  page_copy_json TEXT NOT NULL,
  contact_json TEXT NOT NULL,
  copy_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hostnames (
  hostname TEXT PRIMARY KEY NOT NULL,
  card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lead_sinks (
  id TEXT PRIMARY KEY NOT NULL,
  card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  config_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_sinks_card_id ON lead_sinks (card_id);
