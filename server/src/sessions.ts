import type Database from "better-sqlite3"
import { encrypt } from "./encryption.ts"

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
	}
}

export type SessionManager = ReturnType<typeof createSessionManager>
