-- Feed sources + normalized items. Items are append-only (INSERT OR IGNORE); rating/routing read them later.
CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT NOT NULL UNIQUE,
  name          TEXT,
  interval_min  INTEGER NOT NULL DEFAULT 60,
  error_count   INTEGER NOT NULL DEFAULT 0,
  disabled      INTEGER NOT NULL DEFAULT 0,
  last_status   TEXT,
  last_polled_at INTEGER,
  next_poll_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sources_due ON sources (disabled, next_poll_at);
CREATE TABLE IF NOT EXISTS items (
  id           TEXT PRIMARY KEY,            -- first 32 hex of sha256(source_id + guid-or-url)
  source_id    INTEGER NOT NULL REFERENCES sources(id),
  guid         TEXT NOT NULL,
  url          TEXT,
  title        TEXT,
  author       TEXT,
  published_at TEXT,
  summary      TEXT,
  fetched_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_source ON items (source_id, fetched_at);
