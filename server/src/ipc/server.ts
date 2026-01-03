import ipc from 'node-ipc'
import type { AuthCheck, InvitationCode, ServerID } from "@sso/client"
import { domain, ORIGIN, validateRedirectHost } from "../domain.ts"
import type { SessionManager } from "../sessions/sessions.ts"
import type { InvitationManager } from "../invitations/invitations.ts"

const SERVER_ID: ServerID = 'world'


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

function registerCheckAuthHandler(sessionManager: SessionManager) {
	ipc.server.on(
		'checkAuth',
		(data: AuthCheck.Request, socket) => {
			const { message: { sessionCookie, host, path }, id } = data

			// No session cookie provided
			if (!sessionCookie) {
				ipc.server.emit(socket, 'checkAuth', {
					id,
					message: {
						authenticated: false,
						redirect: buildRedirect(host, path),
					}
				} satisfies AuthCheck.Result)
				return
			}

			// Decrypt session cookie
			const decryptResult = sessionManager.decryptSessionCookie(sessionCookie)
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
					}
				} satisfies AuthCheck.Result)
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
					}
				} satisfies AuthCheck.Result)
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
				}
			} satisfies AuthCheck.Result)
		}
	)
}

function registerInvitationCodeHandler(invitationManager: InvitationManager) {
	ipc.server.on(
		'getInvitationCode',
		(data: InvitationCode.Request, socket) => {
			const { id } = data

			try {
				const code = invitationManager.generateInvitationCode()
				ipc.server.emit(socket, 'getInvitationCode', {
					id,
					message: { code }
				} satisfies InvitationCode.Result)
			} catch (error) {
				console.error('Failed to generate invitation code:', error)
				ipc.server.emit(socket, 'getInvitationCode', {
					id,
					message: { error: error instanceof Error ? error.message : 'Unknown error' }
				} satisfies InvitationCode.Result)
			}
		}
	)
}

export function ipcServer(sessionManager: SessionManager, invitationManager: InvitationManager) {
	ipc.config.id = SERVER_ID
	ipc.config.retry = 1500

	ipc.serve(
		() => {
			registerCheckAuthHandler(sessionManager)
			registerInvitationCodeHandler(invitationManager)
		}
	)

	ipc.server.start()
}