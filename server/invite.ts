#!/usr/bin/env node
import { createSsoClient } from "../client/index.js"

createSsoClient("invite-generator", {
	callback: (client) => {
		client.getInvitationCode()
			.then((code) => {
				console.log(`Invitation code: ${code}`)
				process.exit(0)
			})
			.catch((error) => {
				console.error("Failed to generate invitation code:", error)
				process.exit(1)
			})
	}
})
