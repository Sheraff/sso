import { type GrantProvider } from "grant"
import { type GrantData, type RawGrant } from "#/providers/index.ts"
import { array, minLength, object, parse, string, pipe } from "valibot"

const client_id = process.env.TWITCH_CLIENT_ID
const client_secret = process.env.TWITCH_CLIENT_SECRET

export const options: GrantProvider | undefined = !client_id
	? undefined
	: {
		client_id,
		client_secret,
		scope: ["openid", "user:read:email"],
		response: ["tokens", "profile"],
		nonce: true,
	}

// type TwitchUser = {
// 	id: string
// 	login: string
// 	display_name: string
// 	type: string
// 	broadcaster_type: string
// 	description: string
// 	profile_image_url: string
// 	offline_image_url: string
// 	view_count: number
// 	email: string
// 	created_at: string
// }

const twitchUserShape = object({
	data: pipe(
		array(
			object({
				email: string(),
				id: string(),
			})
		),
		minLength(1)
	),
})

export function getIdFromGrant(response: RawGrant["response"]): GrantData | undefined {
	if (!client_id) throw new Error("Twitch credentials not set in environment")
	if (!response.profile) return undefined
	const { data } = parse(twitchUserShape, response.profile)
	return {
		email: data[0]!.email,
		provider: "twitch",
		id: data[0]!.id,
	}
}