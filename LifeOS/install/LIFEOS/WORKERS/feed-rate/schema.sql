-- Requires feed-ingest/schema.sql first (same D1 database: this stage reads `items`).
CREATE TABLE IF NOT EXISTS ratings (
  item_id       TEXT NOT NULL REFERENCES items(id),
  version       INTEGER NOT NULL DEFAULT 1,    -- bump when the rubric changes; old ratings stay interpretable
  summary_short TEXT,
  summary_medium TEXT,
  tier          TEXT NOT NULL CHECK (tier IN ('S','A','B','C','D')),
  quality_score INTEGER NOT NULL CHECK (quality_score BETWEEN 1 AND 100),
  importance    INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 10),
  novelty       INTEGER NOT NULL CHECK (novelty BETWEEN 1 AND 10),
  urgency       INTEGER NOT NULL CHECK (urgency BETWEEN 1 AND 10),
  labels        TEXT NOT NULL,                  -- JSON array drawn from the fixed taxonomy
  flagged       INTEGER NOT NULL DEFAULT 0,     -- 1 = injection heuristic fired; scores were capped
  model         TEXT NOT NULL,
  rated_at      INTEGER NOT NULL,
  PRIMARY KEY (item_id, version)
);
CREATE INDEX IF NOT EXISTS ratings_rated_at ON ratings (rated_at);
-- Poison-item guard: an item that keeps failing is skipped after 3 attempts instead of burning budget forever.
CREATE TABLE IF NOT EXISTS rate_failures (
  item_id    TEXT PRIMARY KEY REFERENCES items(id),
  count      INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_at    INTEGER
);
