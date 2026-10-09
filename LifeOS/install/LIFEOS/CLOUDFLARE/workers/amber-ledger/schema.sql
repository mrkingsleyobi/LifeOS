-- amber ledger — Synapse's write-ahead journal. Raw rows are immutable;
-- grade/route columns enrich, never rewrite. Nothing is ever deleted.
CREATE TABLE IF NOT EXISTS captures (
  id             TEXT PRIMARY KEY,          -- uuid; becomes source_amber_id on promoted notes
  dedup_key      TEXT NOT NULL UNIQUE,      -- normalized url + content hash, else source:external_id
  source         TEXT NOT NULL,
  external_id    TEXT NOT NULL,
  url            TEXT,
  content        TEXT,
  title          TEXT,
  author         TEXT,
  content_kind   TEXT NOT NULL DEFAULT 'other',
  privacy_class  TEXT NOT NULL DEFAULT 'public',
  captured_at    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'captured',   -- captured | graded | routed | grade_failed
  score          INTEGER,
  route          TEXT,
  excerpt        TEXT,
  grade_version  TEXT,
  routed_actions TEXT                       -- JSON array of strings
);
CREATE INDEX IF NOT EXISTS captures_status ON captures (status, captured_at);
CREATE INDEX IF NOT EXISTS captures_time ON captures (captured_at);
