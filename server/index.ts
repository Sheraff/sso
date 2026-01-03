import { readFileSync } from 'node:fs'
import ipc from 'node-ipc'
import Database from "better-sqlite3"
import type { ServerID } from "@sso/client"
import { webServer } from "./src/web/server.ts"

const SERVER_ID: ServerID = 'world'

ipc.config.id = SERVER_ID
ipc.config.retry = 1500

const schema = readFileSync(new URL('./src/schema.sql', import.meta.url), 'utf-8')

type AuthCheckResult = {
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

ipc.serve(
	() => {
		const db = new Database(process.env.DATABASE_PATH)
		db.pragma("journal_mode = WAL")
		db.pragma("synchronous = NORMAL")
		db.exec(schema)

		ipc.server.on(
			'app.message',
			(data, socket) => {
				// check auth status from db
				// respond with
				// - authenticated: boolean
				// - user data if authenticated (id + email)
				// - headers to set
				//   - set-cookie for session refresh if needed
				ipc.server.emit(
					socket,
					'app.message',
					{
						id: ipc.config.id,
						message: data.message + ' world!'
					}
				)
			}
		)
	}
)

ipc.server.start()
webServer()