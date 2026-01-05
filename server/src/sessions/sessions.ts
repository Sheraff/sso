import type Database from "better-sqlite3"
import { decrypt, encrypt } from "./encryption.ts"
import crypto from "node:crypto"

/**
 * Creates a session manager with prepared statements for efficient database operations.
 * 
 * @param db - SQLite database instance
 * @returns Session manager with methods for session operations
 */
export function createSessionManager(db: Database.Database) {
	type SessionRow = {
		user_id: string
		session_id: string
		expires_at: string
		account_id: string
	}
	// Prepared statement for retrieving valid session with user data
	const getSessionStmt = db.prepare<[session_id: string], SessionRow>(`
		SELECT 
			sessions.user_id,
			sessions.id as session_id,
			sessions.expires_at,
			sessions.account_id
		FROM sessions
		WHERE sessions.id = ?
		AND sessions.expires_at > datetime('now')
	`)

	// Prepared statement for refreshing session expiry (idempotent)
	const refreshSessionStmt = db.prepare<[session_id: string]>(`
		UPDATE sessions 
		SET expires_at = datetime('now', '+50 days')
		WHERE id = ?
	`)

	// Prepared statement for creating a new session
	const createSessionStmt = db.prepare<[id: string, user_id: string, session: string, account_id: string]>(`
		INSERT INTO sessions (id, user_id, session, expires_at, account_id)
		VALUES (?, ?, ?, datetime('now', '+50 days'), ?)
	`)

	// Prepared statement to lookup user by provider account
	const getUserAccountByProviderStmt = db.prepare<[provider: string, provider_user_id: string], { user_id: string, id: string }>(`
		SELECT user_id, id
		FROM accounts
		WHERE provider = ? AND provider_user_id = ?
	`)

	const getAccountByUserStmt = db.prepare<[user_id: string, provider: string], { id: string }>(`
		SELECT id
		FROM accounts
		WHERE user_id = ? AND provider = ?
	`)

	// Prepared statement to create a new user
	const createUserStmt = db.prepare<[id: string, email: string]>(`
		INSERT INTO users (id, email)
		VALUES (?, ?)
	`)

	// Prepared statement to create a new account
	const createAccountStmt = db.prepare<[id: string, user_id: string, provider: string, provider_user_id: string]>(`
		INSERT INTO accounts (id, user_id, provider, provider_user_id)
		VALUES (?, ?, ?, ?)
	`)

	let timeoutId: NodeJS.Timeout | null = null
	function scheduleCleanup() {
		if (timeoutId) clearTimeout(timeoutId)
		timeoutId = setTimeout(() => {
			timeoutId = null
			// Clean up expired sessions
			db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run()
		}, 30_000).unref()
	}

	function createSession(userId: string, accountId: string): string {
		scheduleCleanup()

		const sessionId = crypto.randomUUID()
		const sessionData = JSON.stringify({
			createdAt: new Date().toISOString()
		})
		createSessionStmt.run(sessionId, userId, sessionData, accountId)

		return sessionId
	}

	return {
		/**
		 * Retrieves a valid session with associated user data.
		 * Only returns sessions that haven't expired.
		 * 
		 * @param sessionId - The session ID to look up
		 * @returns Session with user data, or null if not found/expired
		 */
		getSessionWithUser(sessionId: string): SessionRow | null {
			scheduleCleanup()
			return getSessionStmt.get(sessionId) ?? null
		},

		/**
		 * Refreshes a session's expiry time to 50 days from now.
		 * This operation is idempotent and safe for concurrent calls.
		 * 
		 * @param sessionId - The session ID to refresh
		 */
		refreshSession(sessionId: string): void {
			refreshSessionStmt.run(sessionId)
		},

		/**
		 * Encrypts a session ID for use in cookies.
		 * Each encryption produces a unique ciphertext due to random salt/IV.
		 * 
		 * @param sessionId - The session ID to encrypt
		 * @returns Encrypted session cookie value
		 */
		encryptSessionCookie(sessionId: string): string {
			return encrypt(sessionId)
		},

		decryptSessionCookie(cookieValue: string) {
			return decrypt(cookieValue)
		},

		/**
		 * Creates a new session for a user identified by provider credentials.
		 * Looks up the user by provider and provider_user_id, then creates a session.
		 * 
		 * @param provider - OAuth provider name (e.g., "github", "google")
		 * @param providerUserId - User ID from the OAuth provider
		 * @returns Session ID if user found, null if no matching account exists
		 */
		createSessionForProvider(provider: string, providerUserId: string): string | null {
			// Look up user by provider account
			const userRow = getUserAccountByProviderStmt.get(provider, providerUserId)
			if (!userRow) return null
			return createSession(userRow.user_id, userRow.id)
		},

		/**
		 * Creates a new user with a provider account and returns a session ID.
		 * Used during sign-up flow with valid invitation codes.
		 * 
		 * @param provider - OAuth provider name (e.g., "github", "google")
		 * @param providerUserId - User ID from the OAuth provider
		 * @param email - User's email address
		 * @param previousSessionId - existing session, if valid, accounts will be linked (optional)
		 * @returns Session ID for the newly created user
		 */
		createUserWithProvider(provider: string, providerUserId: string, email: string, previousSessionId?: string): string {
			let userId: string | null = null
			let accountId: string | null = null

			if (previousSessionId) {
				// Check if previous session is valid
				const session = this.getSessionWithUser(previousSessionId)
				if (session) {
					userId = session.user_id
					const account = getAccountByUserStmt.get(userId, provider)
					if (account) {
						accountId = account.id
					}
				}
			}

			// Create user
			if (!userId) {
				userId = crypto.randomUUID()
				createUserStmt.run(userId, email)
			}

			// Create provider account
			if (!accountId) {
				accountId = crypto.randomUUID()
				createAccountStmt.run(accountId, userId, provider, providerUserId)
			}

			return createSession(userId, accountId)
		},
	}
}

export type SessionManager = ReturnType<typeof createSessionManager>
