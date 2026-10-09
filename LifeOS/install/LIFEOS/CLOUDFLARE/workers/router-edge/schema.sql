-- router-edge decision ledger (metadata only — prompt text is never stored)
CREATE TABLE IF NOT EXISTS decisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  client       TEXT NOT NULL,
  lane         TEXT NOT NULL,
  tier         TEXT NOT NULL,
  effort       TEXT NOT NULL,
  strategy     TEXT NOT NULL,
  source       TEXT NOT NULL,
  p            REAL,
  intelligence REAL,
  tokens       REAL,
  data_class   TEXT,
  latency_ms   INTEGER,
  jev_model    TEXT
);
CREATE INDEX IF NOT EXISTS decisions_ts ON decisions (ts);
