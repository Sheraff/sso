import * as Twitch from "./twitch.ts"
import * as Google from "./google.ts"
import * as Spotify from "./spotify.ts"
import * as Discord from "./discord.ts"
import * as Github from "./github.ts"

export type RawGrant = {
	provider: string
	response: {
		id_token: string
		access_token: string
		refresh_token: string
		profile?: unknown
	}
}

export type ProviderMeta = {
	name: string
	color: string
	svg: string
}

/**
 * We assume that every oauth server will be able to provide
 * - an email address (careful, this might not be validated by the server, thus might not be enough to sync multiple providers based on same email)
 * - an id-provider pair that is unique to the user (and could allow to re-retrieve the data)
 */
export type GrantData = {
	email: string
	provider: string
	id: string
}

export function getGrantData(grant: RawGrant) {
	switch (grant.provider) {
		case "twitch":
			return Twitch.getIdFromGrant(grant.response)
		case "google":
			return Google.getIdFromGrant(grant.response)
		case "spotify":
			return Spotify.getIdFromGrant(grant.response)
		case "discord":
			return Discord.getIdFromGrant(grant.response)
		case "github":
			return Github.getIdFromGrant(grant.response)
	}
}

export const grantOptions = {
	twitch: Twitch.options,
	google: Google.options,
	spotify: Spotify.options,
	discord: Discord.options,
	github: Github.options,
}

export const providerMetas = {
	twitch: Twitch.meta,
	google: Google.meta,
	spotify: Spotify.meta,
	discord: Discord.meta,
	github: Github.meta,
}

export const activeProviders = Object.entries(grantOptions).filter(([, options]) => options !== undefined).map(([key]) => key)