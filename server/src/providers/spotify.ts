import { type GrantProvider } from "grant"
import { type GrantData, type RawGrant } from "./index.ts"
import { object, parse, string } from "valibot"

const client_id = process.env.SPOTIFY_CLIENT_ID
const client_secret = process.env.SPOTIFY_CLIENT_SECRET

export const options: GrantProvider | undefined = !client_id
	? undefined
	: {
		client_id,
		client_secret,
		scope: ["user-read-email", "user-read-private"],
		response: ["tokens", "profile"],
		nonce: true,
	}

// type SpotifyUser = {
// 	display_name: string
// 	external_urls: {
// 		spotify: string
// 	}
// 	href: string
// 	id: string
// 	images: string[]
// 	type: string
// 	uri: string
// 	followers: {
// 		href: null
// 		total: number
// 	}
// 	country: string
// 	product: string
// 	explicit_content: {
// 		filter_enabled: boolean
// 		filter_locked: boolean
// 	}
// 	email: string
// }

const spotifyUserShape = object({
	email: string(),
	id: string(),
})

export function getIdFromGrant(response: RawGrant["response"]): GrantData | undefined {
	if (!client_id) throw new Error("Spotify credentials not set in environment")
	if (!response.profile) return undefined
	const data = parse(spotifyUserShape, response.profile)
	return {
		email: data.email,
		provider: "spotify",
		id: data.id,
	}
}