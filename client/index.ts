import NodeIPC from 'node-ipc'

export type ServerID = 'world'
const SERVER_ID: ServerID = 'world'

export type CookieName = 'sso_session'
export const COOKIE_NAME: CookieName = 'sso_session'

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'destroyed'

type SsoClient = {
	getInvitationCode: () => Promise<string>
	checkAuth: (sessionCookie: string | undefined, host: string, path: string) => Promise<AuthCheck.Result['message']>
	disconnect: () => void
}

export namespace AuthCheck {
	export type Request = {
		id: number
		message: {
			sessionCookie: string | undefined
			host: string
			path: string
		}
	}
	export type Result = {
		id: number
		message: {
			authenticated: true,
			user_id: string,
			cookie?: string
		} | {
			authenticated: false,
			redirect: string
		}
	}
}

export namespace InvitationCode {
	export type Request = {
		id: number
	}
	export type Result = {
		id: number
		message: {
			code: string
		} | {
			error: string
		}
	}
}


/**
 * Creates an SSO client that connects to the SSO server via IPC.
 * 
 * This client is used by other Node.js applications on the same machine 
 * to authenticate users via the centralized SSO server.
 * 
 * The client establishes a persistent IPC connection that automatically 
 * reconnects if disconnected. Call `disconnect()` to explicitly close 
 * the connection when the client is no longer needed.
 * 
 * @param name - The name of the client application (used for IPC identification)
 * @returns An SSO client with authentication methods
 * 
 * @example
 * ```typescript
 * const sso = createSsoClient('my-app')
 * 
 * // Check authentication
 * const result = await sso.checkAuth(
 *   req.cookies[COOKIE_NAME],
 *   req.hostname,
 *   req.path
 * )
 * 
 * if (result.authenticated) {
 *   console.log('User ID:', result.user_id)
 *   // Update cookie if refreshed
 *   if (result.cookie) {
 *     res.cookie(COOKIE_NAME, result.cookie, { httpOnly: true, secure: true })
 *   }
 * } else {
 *   res.redirect(result.redirect)
 * }
 * 
 * // Cleanup when done
 * process.on('exit', () => sso.disconnect())
 * ```
 */
export function createSsoClient(
	name: string,
	options?: {
		logger?: (msg: string) => void,
		slient?: boolean,
	}
): SsoClient {
	const logger = options?.logger ?? console.log.bind(console)
	const silent = options?.slient ?? false
	const ipc = new NodeIPC.IPC()
	const id = `${name}-${Math.random().toString(16).slice(2)}`
	ipc.config.id = id
	ipc.config.retry = 1000
	ipc.config.silent = silent
	ipc.config.logger = logger

	let state: ConnectionState = 'connecting'

	ipc.connectTo(SERVER_ID, `/tmp/sso-${SERVER_ID}.sock`, () => {
		if (!silent) {
			ipc.of[SERVER_ID].on('error', (err) => {
				logger(`[SSO CLIENT] Connection error: ${err.message || err}`)
			})
		}

		ipc.of[SERVER_ID].on('connect', () => {
			state = 'connected'
			if (!silent) logger('[SSO CLIENT] Connected to SSO server')
		})

		ipc.of[SERVER_ID].on('disconnect', () => {
			state = 'connecting'
			if (!silent) logger('[SSO CLIENT] Disconnected from SSO server, auto-reconnecting...')
		})

		ipc.of[SERVER_ID].on('destroy', () => {
			state = 'destroyed'
			if (!silent) logger('[SSO CLIENT] Connection destroyed')
		})
	})

	let messageId = 0

	/**
	 * Checks the authentication status of a session cookie.
	 * 
	 * This method validates the provided session cookie against the SSO server.
	 * Sessions are automatically refreshed on every call, extending their 
	 * validity by 50 days from the time of this check (sliding window expiration).
	 * 
	 * A new encrypted cookie is returned on every successful authentication,
	 * even if the underlying session ID hasn't changed. This is because each
	 * encryption uses random salt and IV, producing unique ciphertext.
	 * 
	 * Concurrent calls to checkAuth with the same session are safe: all will
	 * receive valid responses with different encrypted cookies representing
	 * the same session.
	 * 
	 * @param sessionCookie - The encrypted session cookie value (or undefined if not present)
	 * @param host - The hostname of the current request (e.g., "app.example.com")
	 * @param path - The path of the current request (e.g., "/dashboard")
	 * @returns Authentication result with user data and refreshed cookie, or redirect URL
	 * 
	 * @example
	 * ```typescript
	 * const result = await sso.checkAuth(
	 *   req.cookies[COOKIE_NAME],
	 *   req.hostname,
	 *   req.path
	 * )
	 * 
	 * if (result.authenticated) {
	 *   // User is authenticated
	 *   req.user = result.user
	 *   
	 *   // Always update the cookie to extend session
	 *   if (result.cookie) {
	 *     res.cookie(COOKIE_NAME, result.cookie, {
	 *       httpOnly: true,
	 *       secure: true,
	 *       sameSite: 'lax',
	 *       maxAge: 50 * 24 * 60 * 60 * 1000 // 50 days
	 *     })
	 *   }
	 *   
	 *   next()
	 * } else {
	 *   // User needs to authenticate
	 *   res.redirect(result.redirect)
	 * }
	 * ```
	 */
	const checkAuth: SsoClient['checkAuth'] = (sessionCookie, host, path) => {
		if (state === 'destroyed') throw new Error('SSO client is destroyed')
		const id = messageId++
		return new Promise<AuthCheck.Result['message']>((resolve, reject) => {
			if (state !== 'connected') {
				reject(new Error('Not connected to SSO server'))
				return
			}

			// Set up timeout (1 second)
			const timeout = setTimeout(() => {
				cleanup()
				reject(new Error('Timed out waiting for authentication response'))
			}, 1000).unref()

			// Set up one-time response handler
			const responseHandler = (data: AuthCheck.Result) => {
				if (data.id !== id) return
				cleanup()
				resolve(data.message)
			}

			const cleanup = () => {
				clearTimeout(timeout)
				ipc.of[SERVER_ID].off('checkAuth', responseHandler)
			}

			// Register response handler
			ipc.of[SERVER_ID].on('checkAuth', responseHandler)

			// Send request
			ipc.of[SERVER_ID].emit('checkAuth', {
				id,
				message: {
					sessionCookie,
					host,
					path
				}
			} satisfies AuthCheck.Request)
		})
	}


	/**
	 * Disconnects from the SSO server and cleans up the IPC connection.
	 * 
	 * Call this method when your application is shutting down or when
	 * the SSO client is no longer needed. This ensures proper cleanup
	 * of IPC resources.
	 * 
	 * @example
	 * ```typescript
	 * const sso = createSsoClient('my-app')
	 * 
	 * // Use the client...
	 * 
	 * // Cleanup on shutdown
	 * process.on('SIGTERM', () => {
	 *   sso.disconnect()
	 *   process.exit(0)
	 * })
	 * ```
	 */
	const disconnect: SsoClient['disconnect'] = () => {
		ipc.disconnect(SERVER_ID)
		state = 'destroyed'
	}

	const getInvitationCode: SsoClient['getInvitationCode'] = () => {
		if (state === 'destroyed') throw new Error('SSO client is destroyed')
		const id = messageId++
		return new Promise<string>((resolve, reject) => {
			if (state !== 'connected') {
				reject(new Error('Not connected to SSO server'))
				return
			}

			// Set up timeout (5 seconds)
			const timeout = setTimeout(() => {
				cleanup()
				reject(new Error('Timed out waiting for invitation code'))
			}, 5000).unref()

			// Set up one-time response handler
			const responseHandler = (data: InvitationCode.Result) => {
				if (data.id !== id) return
				cleanup()
				if ('error' in data.message) {
					reject(new Error(data.message.error))
				} else if ('code' in data.message) {
					resolve(data.message.code)
				} else {
					reject(new Error('Invalid response from server'))
				}
			}

			const cleanup = () => {
				clearTimeout(timeout)
				ipc.of[SERVER_ID].off('getInvitationCode', responseHandler)
			}

			// Register response handler
			ipc.of[SERVER_ID].on('getInvitationCode', responseHandler)

			// Send request
			ipc.of[SERVER_ID].emit('getInvitationCode', { id } satisfies InvitationCode.Request)
		})
	}

	return {
		getInvitationCode,
		checkAuth,
		disconnect
	}
}