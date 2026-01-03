import { type GrantProvider } from "grant"
import { object, parse, string } from "valibot"
import { type GrantData, type RawGrant } from "#/providers/index.ts"

const client_id = process.env.DISCORD_CLIENT_ID
const client_secret = process.env.DISCORD_CLIENT_SECRET

export const options: GrantProvider | undefined = !client_id
	? undefined
	: {
		client_id,
		client_secret,
		scope: ["identify"],
		response: ["tokens", "profile"],
		nonce: true,
	}

// type DiscordUser = {
// 	id: string
// 	username: string
// 	avatar: null
// 	discriminator: string
// 	public_flags: number
// 	premium_type: number
// 	flags: number
// 	banner: null
// 	accent_color: null
// 	global_name: string
// 	avatar_decoration_data: null
// 	banner_color: null
// 	mfa_enabled: boolean
// 	locale: string
// 	email: string
// 	verified: boolean
// }

const discordUserShape = object({
	id: string(),
	email: string(),
})

export function getIdFromGrant(response: RawGrant["response"]): GrantData | undefined {
	if (!client_id) throw new Error("Discord credentials not set in environment")
	if (!response.profile) return undefined
	const data = parse(discordUserShape, response.profile)
	return {
		email: data.email,
		provider: "discord",
		id: data.id,
	}
}