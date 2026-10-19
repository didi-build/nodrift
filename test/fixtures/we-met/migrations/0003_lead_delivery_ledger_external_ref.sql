-- Opaque sink correlation ids for record→append delivery (no visitor PII).
-- JSON object string: flat keys with string, number, boolean, or null values only; max 1024 bytes.
ALTER TABLE lead_delivery_ledger ADD COLUMN external_ref TEXT;
