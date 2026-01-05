CREATE TABLE
	IF NOT EXISTS users (id TEXT NOT NULL PRIMARY KEY, email TEXT NOT NULL);

CREATE TABLE
	IF NOT EXISTS accounts (
		id TEXT NOT NULL PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
		provider TEXT NOT NULL,
		provider_user_id TEXT NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE (user_id, provider, provider_user_id)
	);

CREATE TABLE
	IF NOT EXISTS sessions (
		id TEXT NOT NULL PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
		expires_at DATETIME NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE
	);

CREATE TABLE
	IF NOT EXISTS invites (
		code TEXT NOT NULL PRIMARY KEY,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME NOT NULL
	);

CREATE INDEX IF NOT EXISTS accounts_session_lookup ON accounts (provider, provider_user_id);

CREATE INDEX IF NOT EXISTS accounts_user_id ON accounts (user_id);

CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions (expires_at);

CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id);