-- errata-intake queue: verbatim complaints from apps, drained by `bun Errata.ts pull`
CREATE TABLE IF NOT EXISTS intake (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  app       TEXT NOT NULL,
  verbatim  TEXT NOT NULL,
  drained   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS intake_drained ON intake (drained, ts);
