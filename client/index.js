import NodeIPC from 'node-ipc'

const SERVER_ID = 'world'

export const COOKIE_NAME = 'sso_session'

/** @type {import('./index.d.ts').createSsoClient} */
export function createSsoClient(
	name,
	options
) {
	const logger = options?.logger ?? console.log.bind(console)
	const silent = options?.slient ?? false
	const callback = options?.callback
	const ipc = new NodeIPC.IPC()
	const id = `${name}-${Math.random().toString(16).slice(2)}`
	ipc.config.id = id
	ipc.config.retry = 1000
	ipc.config.silent = silent
	ipc.config.logger = logger

	/** @type {'connecting' | 'connected' | 'disconnected' | 'destroyed'} */
	let state = 'connecting'

	ipc.connectTo(SERVER_ID, `/tmp/sso-${SERVER_ID}.sock`, () => {
		if (!silent) {
			ipc.of[SERVER_ID].on('error', (err) => {
				logger(`[SSO CLIENT] Connection error: ${err.message || err}`)
			})
		}

		ipc.of[SERVER_ID].on('connect', () => {
			state = 'connected'
			if (!silent) logger('[SSO CLIENT] Connected to SSO server')
			if (callback) callback(client)
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

	/** @type {import('./index.d.ts').SsoClient['checkAuth']} */
	const checkAuth = (sessionCookie, host, path) => {
		if (state === 'destroyed') throw new Error('SSO client is destroyed')
		const id = messageId++
		return new Promise((resolve, reject) => {
			if (state !== 'connected') {
				reject(new Error('Not connected to SSO server'))
				return
			}

			// Set up timeout (1 second)
			const timeout = setTimeout(() => {
				cleanup()
				reject(new Error('Timed out waiting for authentication response'))
			}, 1000).unref()

			/**
			 * Set up one-time response handler
			 * @param {import('./index.d.ts').AuthCheck.Result} data
			 */
			const responseHandler = (data) => {
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
			ipc.of[SERVER_ID].emit('checkAuth', /** @type {import('./index.d.ts').AuthCheck.Request} */({
				id,
				message: {
					sessionCookie,
					host,
					path
				}
			}))
		})
	}

	/** @type {import('./index.d.ts').SsoClient['disconnect']} */
	const disconnect = () => {
		ipc.disconnect(SERVER_ID)
		state = 'destroyed'
	}

	/** @type {import('./index.d.ts').SsoClient['getInvitationCode']} */
	const getInvitationCode = () => {
		if (state === 'destroyed') throw new Error('SSO client is destroyed')
		const id = messageId++
		return new Promise((resolve, reject) => {
			if (state !== 'connected') {
				reject(new Error('Not connected to SSO server'))
				return
			}

			// Set up timeout (5 seconds)
			const timeout = setTimeout(() => {
				cleanup()
				reject(new Error('Timed out waiting for invitation code'))
			}, 5000).unref()

			/** 
			 * Set up one-time response handler
			 * @param {import('./index.d.ts').InvitationCode.Result} data
			 */
			const responseHandler = (data) => {
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
			ipc.of[SERVER_ID].emit('getInvitationCode', /** @type {import('./index.d.ts').InvitationCode.Request} */({ id }))
		})
	}

	const client = {
		getInvitationCode,
		checkAuth,
		disconnect
	}

	return client
}