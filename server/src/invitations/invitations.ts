import type Database from "better-sqlite3"
import { generateCode } from "./generateCode.ts"

/**
 * Creates an invitation manager with prepared statements for efficient database operations.
 * 
 * @param db - SQLite database instance
 * @returns Invitation manager with methods for invitation operations
 */
export function createInvitationManager(db: Database.Database) {
	const getCodesStmt = db.prepare<[], { code: string }>(`SELECT code FROM invites`)

	const createInviteStmt = db.prepare<[code: string, expiresAt: string]>(`
		INSERT INTO invites (code, expires_at)
		VALUES (?, datetime(?))
	`)

	const getInviteStmt = db.prepare<[code: string], { code: string }>(`
		SELECT code FROM invites
		WHERE code = ? AND expires_at > datetime('now')
		LIMIT 1
	`)

	const consumeInviteStmt = db.prepare<[code: string]>(`
		DELETE FROM invites
		WHERE code = ?
	`)

	let lastAttemptTime = 0
	let attemptBatchCount = 0

	return {
		/**
		 * Generates a new invitation code and stores it in the database.
		 * 
		 * @returns The newly generated invitation code
		 */
		generateInvitationCode(): string {
			// Generate new code
			const existingCodes = getCodesStmt.all().map(c => c.code)
			const code = generateCode(existingCodes)
			const expiresAt = new Date()
			expiresAt.setDate(expiresAt.getDate() + 30) // 30 days from now

			createInviteStmt.run(code, expiresAt.toISOString())

			return code
		},
		checkInvitationCode(code: string): Promise<boolean> {
			const invited = !!getInviteStmt.get(code)
			if (!invited) {
				// Rate limit failed attempts to prevent brute-forceing
				const now = Date.now()
				if (now - lastAttemptTime < 60_000) {
					attemptBatchCount++
				} else {
					attemptBatchCount = 1
				}
				lastAttemptTime = now
				const delay = Math.min(attemptBatchCount ** 2 * 500, 60_000) // Max 60 seconds
				return new Promise((resolve) => setTimeout(() => resolve(false), delay).unref())
			}
			return new Promise((resolve) => setTimeout(() => resolve(true), 1000)) // Consistent 1 second delay on success
		},
		consumeInvitationCode(code: string): void {
			consumeInviteStmt.run(code)
		}
	}
}

export type InvitationManager = ReturnType<typeof createInvitationManager>