import { readFileSync } from 'node:fs'
import Database from "better-sqlite3"
import { webServer } from "./src/web/server.ts"
import { createSessionManager } from "./src/sessions/sessions.ts"
import { createInvitationManager } from "./src/invitations/invitations.ts"
import { ipcServer } from "./src/ipc/server.ts"

const db = new Database(process.env.DATABASE_PATH)
{
	db.pragma("journal_mode = WAL")
	db.pragma("synchronous = NORMAL")
	const schema = readFileSync(new URL('./src/schema.sql', import.meta.url), 'utf-8')
	db.exec(schema)
}
const sessionManager = createSessionManager(db)
const invitationManager = createInvitationManager(db)

ipcServer(sessionManager, invitationManager)
webServer(sessionManager, invitationManager)