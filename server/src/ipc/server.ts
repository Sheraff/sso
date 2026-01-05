import ipc from 'node-ipc'
import type { AuthCheck, InvitationCode, ServerID } from "@sso/client"
import { domain, ORIGIN, validateRedirectHost } from "../domain.ts"
import type { SessionManager } from "../sessions/sessions.ts"
import type { InvitationManager } from "../invitations/invitations.ts"
import { logger } from '../logger.ts'
import { number, object, optional, safeParse, string } from "valibot"

const SERVER_ID: ServerID = 'world'


// Helper to build redirect URL
const buildRedirect = (pathname: string, targetHost?: string, targetPath?: string): string => {
	const url = new URL(ORIGIN)
	url.pathname = pathname
	if (targetHost) {
		const validHost = validateRedirectHost(targetHost) ? targetHost : domain
		url.searchParams.set('host', validHost)
		if (targetPath) {
			url.searchParams.set('path', targetPath)
		}
	}
	return url.toString()
}

const CheckAuthSchema = object({
	id: number(),
	message: object({
		sessionCookie: optional(string()),
		host: string(),
		path: optional(string()),
	})
})

function registerCheckAuthHandler(sessionManager: SessionManager) {
	ipc.server.on(
		'checkAuth',
		(data: AuthCheck.Request, socket) => {
			const parsed = safeParse(CheckAuthSchema, data)
			if (!parsed.success) {
				logger.warn({ errors: parsed.issues }, 'Invalid checkAuth request')
				ipc.server.emit(socket, 'checkAuth', {
					id: data.id,
					message: {
						authenticated: false,
						redirect: buildRedirect('/'),
					}
				} satisfies AuthCheck.Result)
				return
			}
			const { message: { sessionCookie, host, path }, id } = parsed.output

			// No session cookie provided
			if (!sessionCookie) {
				ipc.server.emit(socket, 'checkAuth', {
					id,
					message: {
						authenticated: false,
						redirect: buildRedirect('/', host, path),
					}
				} satisfies AuthCheck.Result)
				return
			}

			// Decrypt and validate session cookie data
			const decryptResult = sessionManager.decryptSessionData(sessionCookie)
			if ('error' in decryptResult) {
				// Log potential tampering or invalid structure
				logger.warn({
					error: decryptResult.error.message,
					host,
				}, '[SECURITY] Cookie decryption or validation failed')
				ipc.server.emit(socket, 'checkAuth', {
					id,
					message: {
						authenticated: false,
						redirect: buildRedirect('/', host, path),
					}
				} satisfies AuthCheck.Result)
				return
			}

			const { sessionId, provider, expiresAt } = decryptResult.success

			// Check if session has expired (7-day validity)
			const now = new Date()
			const expirationDate = new Date(expiresAt)
			if (now > expirationDate) {
				// Session expired - redirect to transparent re-auth
				ipc.server.emit(socket, 'checkAuth', {
					id,
					message: {
						authenticated: false,
						redirect: buildRedirect(`/submit/${provider}`, host, path),
					}
				} satisfies AuthCheck.Result)
				return
			}

			// Get session with user data from database
			const session = sessionManager.getSessionWithUser(sessionId)
			if (!session) {
				// Session not in database (deleted or never existed)
				ipc.server.emit(socket, 'checkAuth', {
					id,
					message: {
						authenticated: false,
						redirect: buildRedirect('/', host, path),
					}
				} satisfies AuthCheck.Result)
				return
			}

			// Session valid - return authenticated result
			ipc.server.emit(socket, 'checkAuth', {
				id,
				message: {
					authenticated: true,
					user_id: session.user_id,
				}
			} satisfies AuthCheck.Result)
		}
	)
}

const InvitationCodeSchema = object({
	id: number(),
})

function registerInvitationCodeHandler(invitationManager: InvitationManager) {
	ipc.server.on(
		'getInvitationCode',
		(data: InvitationCode.Request, socket) => {
			const parsed = safeParse(InvitationCodeSchema, data)
			if (!parsed.success) {
				logger.warn({ errors: parsed.issues }, 'Invalid getInvitationCode request')
				ipc.server.emit(socket, 'getInvitationCode', {
					id: data.id,
					message: { error: 'Invalid request' }
				} satisfies InvitationCode.Result)
				return
			}
			const { id } = parsed.output

			try {
				const code = invitationManager.generateInvitationCode()
				ipc.server.emit(socket, 'getInvitationCode', {
					id,
					message: { code }
				} satisfies InvitationCode.Result)
			} catch (error) {
				logger.error({ error }, 'Failed to generate invitation code')
				ipc.server.emit(socket, 'getInvitationCode', {
					id,
					message: { error: error instanceof Error ? error.message : 'Unknown error' }
				} satisfies InvitationCode.Result)
			}
		}
	)
}

export function ipcServer(sessionManager: SessionManager, invitationManager: InvitationManager): typeof ipc {
	ipc.config.id = SERVER_ID
	ipc.config.retry = 1500
	const ipcLogger = logger.child({ component: 'ipc-server' })
	ipc.config.logger = ipcLogger.info.bind(ipcLogger)

	ipc.serve(
		`/tmp/sso-${SERVER_ID}.sock`,
		() => {
			registerCheckAuthHandler(sessionManager)
			registerInvitationCodeHandler(invitationManager)
		}
	)

	ipc.server.start()

	return ipc
}