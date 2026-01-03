import { readFileSync } from 'node:fs'
import ipc from 'node-ipc'
import Database from "better-sqlite3"
import type { ServerID, AuthCheckResult, CookieName } from "@sso/client"
import { webServer } from "./src/web/server.ts"
import { createSessionManager } from "./src/sessions.ts"
import { decrypt } from "./src/encryption.ts"
import { domain, ORIGIN, validateRedirectHost } from "./src/domain.ts"

const SERVER_ID: ServerID = 'world'
const COOKIE_NAME: CookieName = 'sso_session'

ipc.config.id = SERVER_ID
ipc.config.retry = 1500

// Helper to build redirect URL
const buildRedirect = (targetHost: string, targetPath?: string): string => {
	const validHost = validateRedirectHost(targetHost) ? targetHost : domain
	const url = new URL(ORIGIN)
	url.searchParams.set('host', validHost)
	if (targetPath) {
		url.searchParams.set('path', targetPath)
	}
	return url.toString()
}

const db = new Database(process.env.DATABASE_PATH)
{
	db.pragma("journal_mode = WAL")
	db.pragma("synchronous = NORMAL")
	const schema = readFileSync(new URL('./src/schema.sql', import.meta.url), 'utf-8')
	db.exec(schema)
}
const sessionManager = createSessionManager(db)

ipc.serve(
	() => {

		ipc.server.on(
			'checkAuth',
			(data: { sessionCookie?: string; host: string; path?: string, id: number }, socket) => {
				const { sessionCookie, host, path, id } = data

				// No session cookie provided
				if (!sessionCookie) {
					ipc.server.emit(socket, 'checkAuth', {
						id,
						message: {
							authenticated: false,
							redirect: buildRedirect(host, path),
						} satisfies AuthCheckResult
					})
					return
				}

				// Decrypt session cookie
				const decryptResult = decrypt(sessionCookie)
				if ('error' in decryptResult) {
					// Log potential tampering attempt
					console.warn('[SECURITY] Cookie decryption failed:', {
						timestamp: new Date().toISOString(),
						error: decryptResult.error.message,
						host,
					})
					ipc.server.emit(socket, 'checkAuth', {
						id,
						message: {
							authenticated: false,
							redirect: buildRedirect(host, path),
						} satisfies AuthCheckResult
					})
					return
				}

				const sessionId = decryptResult.success

				// Get session with user data
				const session = sessionManager.getSessionWithUser(sessionId)
				if (!session) {
					ipc.server.emit(socket, 'checkAuth', {
						id,
						message: {
							authenticated: false,
							redirect: buildRedirect(host, path),
						} satisfies AuthCheckResult
					})
					return
				}

				// Refresh session (extends expiry by 50 days)
				sessionManager.refreshSession(sessionId)

				// Generate new encrypted cookie
				const newCookie = sessionManager.encryptSessionCookie(sessionId)

				// Return authenticated result
				ipc.server.emit(socket, 'checkAuth', {
					id,
					message: {
						authenticated: true,
						user_id: session.user_id,
						cookie: newCookie,
					} satisfies AuthCheckResult
				})
			}
		)
	}
)

ipc.server.start()
webServer(sessionManager)