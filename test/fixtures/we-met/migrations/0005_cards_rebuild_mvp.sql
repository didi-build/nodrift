-- Rebuild published cards for MVP (ADR 0025). Not expand-only: hand-applied after emptying cards.
-- Fails loudly when cards holds any row (invalid status trips cards_new CHECK). Seeds app_settings when empty.

DROP TABLE IF EXISTS cards_new;

INSERT INTO app_settings (key, value)
SELECT 'signups_open', '0'
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings WHERE key = 'signups_open'
);

INSERT INTO app_settings (key, value)
SELECT 'lead_email_enabled', '1'
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings WHERE key = 'lead_email_enabled'
);

CREATE TABLE cards_new (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('green', 'mono')),
  display_name TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  status TEXT NOT NULL CHECK (status IN ('live', 'suspended', 'retired')),
  photo_key TEXT,
  links_json TEXT NOT NULL,
  page_copy_json TEXT NOT NULL,
  contact_json TEXT NOT NULL,
  copy_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Invalid status on copy fails CHECK when legacy `cards` has rows; empty `cards` inserts zero rows.
INSERT INTO cards_new (
  id,
  slug,
  variant,
  display_name,
  account_id,
  status,
  photo_key,
  links_json,
  page_copy_json,
  contact_json,
  copy_json,
  updated_at
)
SELECT
  c.id,
  c.slug,
  c.variant,
  c.display_name,
  '00000000-0000-0000-0000-000000000000',
  '__legacy_nonempty_cards__',
  c.photo_key,
  c.links_json,
  c.page_copy_json,
  c.contact_json,
  c.copy_json,
  c.updated_at
FROM cards AS c;

DROP TABLE cards;

ALTER TABLE cards_new RENAME TO cards;

CREATE UNIQUE INDEX cards_slug_unique ON cards (slug);

CREATE UNIQUE INDEX cards_one_per_account ON cards (account_id);

CREATE UNIQUE INDEX lead_sinks_one_email_per_card ON lead_sinks (card_id)
WHERE
  kind = 'email';
