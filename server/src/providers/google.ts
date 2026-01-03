import { type GrantProvider } from "grant"
import { type GrantData, type RawGrant } from "#/providers/index.ts"
import { object, parse, string } from "valibot"

const client_id = process.env.GOOGLE_CLIENT_ID
const client_secret = process.env.GOOGLE_CLIENT_SECRET

export const options: GrantProvider | undefined = !client_id
	? undefined
	: {
		client_id,
		client_secret,
		scope: ["openid", "https://www.googleapis.com/auth/userinfo.email"],
		response: ["tokens", "profile"],
		nonce: true,
	}

// type GoogleUser = {
// 	sub: string
// 	picture: string
// 	email: string
// 	email_verified: boolean
// 	hd: string
// }

const googleUserShape = object({
	email: string(),
})

export function getIdFromGrant(response: RawGrant["response"]): GrantData | undefined {
	if (!client_id) throw new Error("google credentials not set in environment")
	if (!response.profile) return undefined
	const data = parse(googleUserShape, response.profile)
	return {
		email: data.email,
		provider: "google",
		id: data.email,
	}
}