-- Requires feed-ingest and feed-rate schemas first (same D1 `feed` database).
-- One row per (item, destination): idempotent delivery, and a visible record of everything not delivered.
CREATE TABLE IF NOT EXISTS deliveries (
  item_id     TEXT NOT NULL REFERENCES items(id),
  destination TEXT NOT NULL,        -- notify | digest | blog-draft | social-post | archive | stale | * (suppressed)
  priority    TEXT NOT NULL,        -- immediate | daily | weekly | archive
  status      TEXT NOT NULL CHECK (status IN ('pending','sent','failed','queued','unsupported','archived','suppressed','skipped')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER,
  PRIMARY KEY (item_id, destination)
);
CREATE INDEX IF NOT EXISTS deliveries_status ON deliveries (status, destination, priority);
