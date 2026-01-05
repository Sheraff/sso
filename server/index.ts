import { readFileSync } from 'node:fs'
import Database from "better-sqlite3"
import { webServer } from "./src/web/server.ts"
import { createSessionManager } from "./src/sessions/sessions.ts"
import { createInvitationManager } from "./src/invitations/invitations.ts"
import { ipcServer } from "./src/ipc/server.ts"
import tx2 from 'tx2'

const db = new Database(process.env.DATABASE_PATH)
{
	db.pragma("journal_mode = WAL")
	db.pragma("synchronous = NORMAL")
	const schema = readFileSync(new URL('./src/schema.sql', import.meta.url), 'utf-8')
	db.exec(schema)
}
const sessionManager = createSessionManager(db)
const invitationManager = createInvitationManager(db)

const ipc = ipcServer(sessionManager, invitationManager)
const web = webServer(sessionManager, invitationManager)

tx2.action('invite', (reply) => {
	const code = invitationManager.generateInvitationCode()
	reply({ answer: code })
})

process.on("SIGINT", async () => {
	console.log("\nSIGINT received, shutting down...")
	await web.close().catch(console.error)
	ipc.server.stop()
	db.close()
	console.log("Server shut down, exiting.")
	process.exit(0)
})

process.send?.('ready')