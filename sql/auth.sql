-- Authentication and session tables. No user credentials are seeded here.
CREATE TABLE IF NOT EXISTS app_users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_salt VARCHAR(64) NOT NULL,
  password_hash VARCHAR(128) NOT NULL,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_username_format CHECK (username ~ '^[a-z0-9._-]{3,80}$')
);
CREATE TABLE IF NOT EXISTS app_user_roles (
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('ADMIN','OPERATOR','KITCHEN')),
  PRIMARY KEY(user_id, organization_id)
);
CREATE TABLE IF NOT EXISTS app_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON app_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON app_sessions(user_id);