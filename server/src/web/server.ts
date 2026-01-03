import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import session from '@fastify/session'
import grant from "grant"
import { readFileSync } from 'node:fs'
import { grantOptions, getGrantData, type RawGrant } from "../providers/index.ts"
import { domain, ORIGIN, validateRedirectHost } from "../domain.ts"
import type { CookieName } from "@sso/client"
import { type SessionManager } from "../sessions/sessions.ts"
import type { InvitationManager } from "../invitations/invitations.ts"
import { logger } from '../logger.ts'

// Extend Fastify session types
declare module '@fastify/session' {
	interface FastifySessionObject {
		grant?: RawGrant
	}
}

const PORT = process.env.PORT!
if (!PORT) throw new Error("PORT not set in environment")

const COOKIE_NAME: CookieName = 'sso_session'
export function webServer(sessionManager: SessionManager, invitationManager: InvitationManager) {

	const fastify = Fastify({
		loggerInstance: logger
	})

	// Register cookie and session plugins (required by Grant)
	void fastify.register(cookie)
	void fastify.register(session, {
		secret: process.env.ENCRYPTION_KEY!,
		cookie: {
			secure: domain !== 'localhost',
			httpOnly: true,
			maxAge: 600000 // 10 minutes - only for OAuth flow
		}
	})

	// Root page - sets redirect cookies
	fastify.get<{ Querystring: { host?: string, path?: string } }>('/', function (request, reply) {
		// Get redirect parameters from query
		let host = request.query.host
		if (!host && request.headers.referer) {
			try {
				host = new URL(request.headers.referer).hostname
			} catch { }
		}


		// Set temporary cookies to preserve redirect destination through OAuth flow
		if (host) {
			reply.setCookie('redirect_host', host, {
				httpOnly: true,
				secure: domain !== 'localhost',
				domain: domain === 'localhost' ? undefined : `.${domain}`,
				sameSite: 'lax',
				maxAge: 600, // 10 minutes - just long enough for OAuth flow
				path: '/'
			})
			const path = request.query.path
			if (path) {
				reply.setCookie('redirect_path', path, {
					httpOnly: true,
					secure: domain !== 'localhost',
					domain: domain === 'localhost' ? undefined : `.${domain}`,
					sameSite: 'lax',
					maxAge: 600, // 10 minutes
					path: '/'
				})
			}
		}


		/**
		 * Serve a web page that allows
		 * - signing in with OAuth providers (available providers from grantOptions)
		 * - signing up with invitation code (step 1 of invitation flow) + oauth (step 2)
		 * 
		 * Links to /connect/{provider} (no query params needed)
		 */

		const providers = Object.entries(grantOptions).filter((p) => p[1])

		let html = readFileSync(new URL('./signin.html', import.meta.url), 'utf-8')

		// Inject provider buttons
		const providerButtons = providers.map(([name]) =>
			`<button type="submit" formaction="/submit/${name}" class="provider-btn">${name.charAt(0).toUpperCase() + name.slice(1)}</button>`
		).join('\n\t\t\t\t')

		html = html.replace('<!-- PROVIDER_BUTTONS -->', providerButtons)

		reply.type('text/html').send(html)
	})

	// Submit route - validates invitation code and redirects
	fastify.get<{ Querystring: { inviteCode?: string }, Params: { provider: string } }>('/submit/:provider', async function (request, reply) {
		const { provider } = request.params

		if (!(provider in grantOptions) || !grantOptions[provider as keyof typeof grantOptions]) {
			return reply.redirect('/', 304)
		}

		const inviteCode = request.query.inviteCode?.trim()

		// No invitation code - normal sign-in flow
		if (!inviteCode) {
			return reply.redirect(`/connect/${provider}`)
		}

		// Validate invitation code
		const invited = await invitationManager.checkInvitationCode(inviteCode)

		if (!invited) {
			// Invalid or expired code - redirect back to root
			return reply.redirect('/')
		}

		// Valid code - store in cookie and redirect to OAuth
		reply.setCookie('invite_code', inviteCode, {
			httpOnly: true,
			secure: domain !== 'localhost',
			domain: domain === 'localhost' ? undefined : `.${domain}`,
			sameSite: 'lax',
			maxAge: 600, // 10 minutes
			path: '/'
		})

		return reply.redirect(`/connect/${provider}`)
	})

	// Register Grant middleware
	void fastify.register(
		grant.default.fastify({
			defaults: {
				origin: ORIGIN,
				transport: "session", // Response data goes to session
				state: true,
				prefix: "/connect",
				callback: "/auth/callback", // Our custom callback route
			},
			...grantOptions,
		})
	)

	// Our custom callback route - receives all OAuth responses
	fastify.get('/auth/callback', async (request, reply) => {
		// Access Grant's session data
		const grantSession = request.session.grant

		if (!grantSession) {
			fastify.log.error('OAuth callback missing grant session')
			return reply.status(400).send({ error: 'Invalid OAuth callback' })
		}

		// Extract user data from OAuth response
		const grantData = getGrantData(grantSession)
		if (!grantData) {
			fastify.log.error({ provider: grantSession.provider }, 'Failed to extract grant data')
			return reply.status(400).send({ error: 'Invalid OAuth response' })
		}

		// Create session for existing user
		let sessionId = sessionManager.createSessionForProvider(
			grantData.provider,
			grantData.id
		)

		if (!sessionId) {
			// User not found - check for invitation code
			const inviteCode = request.cookies.invite_code

			// Clear invitation code cookie if present
			if (inviteCode) {
				reply.clearCookie('invite_code', {
					domain: domain === 'localhost' ? undefined : `.${domain}`,
					path: '/'
				})
			}

			// Validate invitation code and create user
			if (inviteCode && await invitationManager.checkInvitationCode(inviteCode)) {
				// Valid invitation - create new user with provider account and session
				fastify.log.info({
					provider: grantData.provider,
					providerId: grantData.id,
					email: grantData.email,
					inviteCode
				}, 'Creating new user with invitation code')

				let previousSessionId: string | undefined
				const sessionCookie = request.cookies[COOKIE_NAME]
				if (sessionCookie) {
					const result = sessionManager.decryptSessionCookie(sessionCookie)
					if ('success' in result) {
						previousSessionId = result.success
					}
				}

				sessionId = sessionManager.createUserWithProvider(
					grantData.provider,
					grantData.id,
					grantData.email,
					previousSessionId
				)

				invitationManager.consumeInvitationCode(inviteCode)

				// Continue to session cookie creation below
			}
		}

		if (!sessionId) {
			// No session and no valid invitation code - redirect to root for sign-up
			fastify.log.warn({
				provider: grantData.provider,
				providerId: grantData.id,
				email: grantData.email
			}, 'OAuth sign-in for non-existent user without valid invitation')

			// Clear any existing session cookie
			reply.clearCookie(COOKIE_NAME, {
				domain: domain === 'localhost' ? undefined : `.${domain}`,
				path: '/'
			})

			// Keep redirect cookies for after sign-up completes
			// Redirect to root for sign-up
			return reply.redirect(ORIGIN)
		}

		// User found - create session and redirect back to app

		// Encrypt session ID for cookie
		const encryptedCookie = sessionManager.encryptSessionCookie(sessionId)

		// Set session cookie for all subdomains
		reply.setCookie(COOKIE_NAME, encryptedCookie, {
			httpOnly: true,
			secure: domain !== 'localhost', // HTTPS only in production
			domain: domain === 'localhost' ? undefined : `.${domain}`, // Share across *.example.com
			sameSite: 'lax', // CSRF protection
			maxAge: 50 * 24 * 60 * 60, // 50 days in seconds
			path: '/'
		})

		// Clear temporary redirect cookies
		reply.clearCookie('redirect_host', {
			domain: domain === 'localhost' ? undefined : `.${domain}`,
			path: '/'
		})
		reply.clearCookie('redirect_path', {
			domain: domain === 'localhost' ? undefined : `.${domain}`,
			path: '/'
		})

		// Build redirect URL from temporary cookies
		const redirectHost = request.cookies.redirect_host
		const redirectPath = request.cookies.redirect_path
		let redirectUrl
		const protocol = domain === 'localhost' ? 'http' : 'https'
		if (redirectHost && validateRedirectHost(redirectHost)) {
			const host = redirectHost
			redirectUrl = `${protocol}://${host}${redirectPath || '/'}`
		} else {
			redirectUrl = `${protocol}://${domain}`
		}

		fastify.log.info({
			provider: grantData.provider,
			redirectUrl
		}, 'OAuth sign-in successful')

		// Redirect back to application
		return reply.redirect(redirectUrl)
	})

	fastify.listen({ port: Number(PORT) }, function (err, address) {
		if (err) {
			fastify.log.error(err)
			process.exit(1)
		}
		// Server is now listening on ${address}
	})
}