CREATE TABLE IF NOT EXISTS builds (
  code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_builds_expires_at ON builds(expires_at);
CREATE INDEX IF NOT EXISTS idx_builds_last_accessed ON builds(last_accessed);

CREATE TABLE IF NOT EXISTS membership_cache (
  user_id TEXT PRIMARY KEY,
  is_member INTEGER NOT NULL CHECK (is_member IN (0, 1)),
  checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS request_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_nonces_expires_at ON request_nonces(expires_at);

CREATE TABLE IF NOT EXISTS export_guard (
  user_id TEXT PRIMARY KEY,
  last_attempt_ms INTEGER NOT NULL,
  rapid_count INTEGER NOT NULL DEFAULT 0,
  blocked_until_ms INTEGER NOT NULL DEFAULT 0,
  cooldown_until_ms INTEGER NOT NULL DEFAULT 0
);
