-- Amber ledger (cloud half): append-only. No UPDATE or DELETE statements exist in the Worker.
CREATE TABLE IF NOT EXISTS captures (
  id            TEXT PRIMARY KEY,          -- first 32 hex of the dedup key
  source        TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  url           TEXT,
  content       TEXT,
  content_kind  TEXT NOT NULL,
  title         TEXT,
  author        TEXT,
  privacy_class TEXT NOT NULL CHECK (privacy_class = 'public'),  -- personal never reaches the cloud ledger
  captured_at   TEXT NOT NULL,
  ingested_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS captures_source ON captures (source, captured_at);
