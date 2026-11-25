CREATE TABLE IF NOT EXISTS builds (
  code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_builds_expires_at
ON builds(expires_at);
