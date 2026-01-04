import { type GrantProvider } from "grant"
import { type GrantData, type ProviderMeta, type RawGrant } from "./index.ts"
import { array, minLength, object, parse, string, pipe } from "valibot"

const client_id = process.env.TWITCH_CLIENT_ID
const client_secret = process.env.TWITCH_CLIENT_SECRET

export const meta: ProviderMeta = {
	name: 'Twitch',
	color: '#9146FF',
	svg: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"
}

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