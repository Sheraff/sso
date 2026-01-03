import type Database from "better-sqlite3"
import { encrypt } from "./encryption.ts"
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
	}
	// Prepared statement for retrieving valid session with user data
	const getSessionStmt = db.prepare<[string], SessionRow>(`
		SELECT 
			sessions.user_id,
			sessions.id as session_id,
			sessions.expires_at
		FROM sessions
		WHERE sessions.id = ?
		AND sessions.expires_at > datetime('now')
	`)

	// Prepared statement for refreshing session expiry (idempotent)
	const refreshSessionStmt = db.prepare<[string]>(`
		UPDATE sessions 
		SET expires_at = datetime('now', '+50 days')
		WHERE id = ?
	`)

	// Prepared statement for creating a new session
	const createSessionStmt = db.prepare<[string, string, string]>(`
		INSERT INTO sessions (id, user_id, session, expires_at)
		VALUES (?, ?, ?, datetime('now', '+50 days'))
	`)

	// Prepared statement to lookup user by provider account
	const getUserByProviderStmt = db.prepare<[string, string], { user_id: string }>(`
		SELECT user_id
		FROM accounts
		WHERE provider = ? AND provider_user_id = ?
	`)

	return {
		/**
		 * Retrieves a valid session with associated user data.
		 * Only returns sessions that haven't expired.
		 * 
		 * @param sessionId - The session ID to look up
		 * @returns Session with user data, or null if not found/expired
		 */
		getSessionWithUser(sessionId: string): SessionRow | null {
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
			const userRow = getUserByProviderStmt.get(provider, providerUserId)
			if (!userRow) return null

			// Generate new session ID
			const sessionId = crypto.randomUUID()

			// Create session with metadata
			const sessionData = JSON.stringify({
				createdAt: new Date().toISOString()
			})
			createSessionStmt.run(sessionId, userRow.user_id, sessionData)

			return sessionId
		},
	}
}

export type SessionManager = ReturnType<typeof createSessionManager>
