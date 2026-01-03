import NodeIPC from 'node-ipc'

export type ServerID = 'world'
const SERVER_ID: ServerID = 'world'

type SsoClient = {
	getInvitationCode: () => Promise<string>
	checkAuth: (sessionCookie: string | undefined) => Promise<AuthCheckResult>
}

export type AuthCheckResult = {
	authenticated: true,
	user: {
		id: string
		email: string
	}
	cookie?: string
} | {
	authenticated: false,
	redirect: string
}


/**
 * Creates an SSO client that connects to the SSO server via IPC.
 * 
 * This is used by other Node.js on the same machine to ensure the
 * user is logged in.
 * 
 * Send in the session cookie attached to a request to authenticate.
 * 
 * @param name The name of the client application.
 */
function createSsoClient(name: string): SsoClient {
	const ipc = new NodeIPC.IPC()
	const id = `${name}-${Math.random().toString(16).slice(2)}`
	ipc.config.id = id
	ipc.config.retry = 1000

	let connected = false

	function connect() {
		connected = false
		ipc.connectTo(
			SERVER_ID,
			() => {
				ipc.of[SERVER_ID].on('disconnect', connect)
				ipc.of[SERVER_ID].on('connect', () => {
					connected = true
				})
			}
		)
	}

	connect()

	return {
		getInvitationCode: () => { },
		checkAuth: (sessionCookie) => { },
	}
}

const ipc = new NodeIPC.IPC()
ipc.config.id = 'hello'
ipc.config.retry = 1000

ipc.connectTo(
	'world',
	() => {
		ipc.of.world.on(
			'connect',
			() => {
				ipc.log('## connected to world ##')
				ipc.of.world.emit(
					'app.message',
					{
						id: ipc.config.id,
						message: 'hello'
					}
				)
			}
		)
		ipc.of.world.on(
			'disconnect',
			() => {
				ipc.log('disconnected from world')
			}
		)
		ipc.of.world.on(
			'app.message',
			(data) => {
				ipc.log('got a message from world : ', data)
			}
		)
	}
)