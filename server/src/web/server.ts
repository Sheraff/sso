import Fastify, { type Session } from 'fastify'
import cookie from '@fastify/cookie'
import session from '@fastify/session'
import grant from "grant"
import { readFileSync } from 'node:fs'
import { grantOptions, getGrantData, type RawGrant, providerMetas } from "../providers/index.ts"
import { domain, hostname, ORIGIN, validateRedirectHost } from "../domain.ts"
import type { CookieName } from "@sso/client"
import { type SessionManager } from "../sessions/sessions.ts"
import type { InvitationManager } from "../invitations/invitations.ts"
import { logger } from '../logger.ts'
import { createLRUCache } from "../lru-cache.ts"

// Extend Fastify session types
declare module '@fastify/session' {
	interface FastifySessionObject {
		grant?: RawGrant
	}
}

const PORT = process.env.PORT!
if (!PORT) throw new Error("PORT not set in environment")


// function makeStore() {
// 	const store = new Map<string, any>()
// 	return {
// 		get: (id: string, cb: (session: any) => void) => {
// 			console.log(`STORE GET ${id}: `, store.get(id))
// 			cb(store.get(id))
// 		},
// 		set: (id: string, session: any, cb: () => void) => {
// 			console.log(`STORE SET ${id}: `, session)
// 			store.set(id, session)
// 			cb()
// 		},
// 		destroy: (id: string, cb: () => void) => {
// 			console.log(`STORE DESTROY ${id}`)
// 			store.delete(id)
// 			cb()
// 		}
// 	}
// }

// const DEBUG_STORE = makeStore()

const COOKIE_NAME: CookieName = 'sso_session'
export function webServer(sessionManager: SessionManager, invitationManager: InvitationManager) {

	const fastify = Fastify({
		loggerInstance: logger.child({ component: 'web-server' }),
		trustProxy: true, // Required when behind nginx/reverse proxy for secure cookies
	})

	// Register cookie and session plugins (required by Grant)
	void fastify.register(cookie)
	void fastify.register(session, {
		secret: process.env.ENCRYPTION_KEY!,
		cookie: {
			// No domain set - defaults to exact hostname (sso.florianpellet.com)
			secure: domain !== 'localhost',
			httpOnly: true,
			sameSite: 'lax', // Critical for OAuth callbacks
			path: '/',
			maxAge: 86400000 // 1 day in milliseconds
		},
		saveUninitialized: true, // Save session even if empty - Grant needs this
		rolling: false,
		logLevel: "trace",
		store: createLRUCache<string, Session>(20),
	})

	// Register Grant middleware
	void fastify.register(
		grant.default.fastify({
			defaults: {
				origin: ORIGIN,
				transport: "session",
				state: true,
				prefix: "/connect",
				callback: "/auth/callback", // Our custom callback route
			},
			...grantOptions,
		})
	)

	////////////////////////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////////////////////////
	/**
	 * For some fucking reason, the session is not initialized before Grant tries to use it,
	 * and it's not saved after Grant modifies it, so we have to do it manually here.
	 * 
	 * I would like to shit in the mouth of all those involved.
	 */
	fastify.addHook('preHandler', async (request, reply) => {
		if (request.url.startsWith('/connect/')) {
			// Initialize session if not already done, forcing it to be created and saved
			if (request.session) {
				await new Promise((resolve) => {
					request.session.save(resolve)
				})
			}
		}
	})
	fastify.addHook('onSend', async (request, reply) => {
		if (request.url.startsWith('/connect/')) {
			// Grant is about to redirect - ensure session is saved first
			if (request.session) {
				await new Promise((resolve) => {
					request.session.save(resolve)
				})
			}
		}
	})
	////////////////////////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////////////////////////

	// / - Root page - sets redirect cookies
	fastify.get<{ Querystring: { host?: string, path?: string, error?: string } }>('/', function (request, reply) {
		/**
		 * Serve a web page that allows
		 * - signing in with OAuth providers (available providers from grantOptions)
		 * - signing up with invitation code (step 1 of invitation flow) + oauth (step 2)
		 * 
		 * Links to /connect/{provider} (no query params needed)
		 */

		// Log OAuth errors from Grant
		if (request.query.error) {
			fastify.log.error({
				error: request.query.error,
				cookies: request.cookies,
				headers: request.headers
			}, 'OAuth error redirected to root')
		}

		const providers = Object.entries(grantOptions).filter((p) => p[1])
		const lastProvider = request.cookies.last_provider

		let html = readFileSync(new URL('./signin.html', import.meta.url), 'utf-8')

		// Inject provider buttons
		const providerButtons = providers.map(([key]) => {
			const meta = providerMetas[key as keyof typeof providerMetas]
			const isLastUsed = key === lastProvider
			const label = isLastUsed ? `${meta.name} (Last used)` : meta.name
			const className = isLastUsed ? 'provider-btn last-used' : 'provider-btn'
			return `<button type="submit" formaction="/submit/${key}" class="${className}" style="--provider-color: ${meta.color};">
				<svg role="img" viewBox="0 0 24 24"><path d="${meta.svg}"/></svg>
				<span>${label}</span>
			</button>`
		}).join('\n\t\t\t\t')
		html = html.replace('<!-- PROVIDER_BUTTONS -->', providerButtons)

		// Get redirect parameters from query
		let hiddenFields = ''
		let host = request.query.host
		if (!host && request.headers.referer) {
			try {
				host = new URL(request.headers.referer).hostname
			} catch { }
		}
		if (host) {
			hiddenFields += `<input type="hidden" name="host" value="${host}"/>`
			if (request.query.path) {
				hiddenFields += `<input type="hidden" name="path" value="${request.query.path}"/>`
			}
		}
		html = html.replace('<!-- HIDDEN_FIELDS -->', hiddenFields)

		reply.type('text/html').send(html)
	})

	// /submit/:provider - Submit route - validates invitation code and redirects
	fastify.get<{ Querystring: { inviteCode?: string, host?: string, path?: string }, Params: { provider: string } }>('/submit/:provider', async function (request, reply) {
		const { provider } = request.params

		if (!(provider in grantOptions) || !grantOptions[provider as keyof typeof grantOptions]) {
			return reply.redirect('/', 304)
		}

		const inviteCode = request.query.inviteCode?.trim()

		// Validate invitation code
		const invited = inviteCode && await invitationManager.checkInvitationCode(inviteCode)

		if (inviteCode && !invited) {
			// Invalid or expired code - redirect back to root
			return reply.redirect('/')
		}

		if (inviteCode) {
			// Valid code - store in cookie and redirect to OAuth
			reply.setCookie('invite_code', inviteCode, {
				httpOnly: true,
				secure: domain !== 'localhost',
				domain: domain === 'localhost' ? undefined : `.${domain}`,
				sameSite: 'lax',
				maxAge: 600, // 10 minutes
				path: '/'
			})
		}

		// Set temporary cookies to preserve redirect destination through OAuth flow
		if (request.query.host) {
			reply.setCookie('redirect_host', request.query.host, {
				httpOnly: true,
				secure: domain !== 'localhost',
				domain: domain === 'localhost' ? undefined : `.${domain}`,
				sameSite: 'lax',
				maxAge: 600, // 10 minutes - just long enough for OAuth flow
				path: '/'
			})
			if (request.query.path) {
				reply.setCookie('redirect_path', request.query.path, {
					httpOnly: true,
					secure: domain !== 'localhost',
					domain: domain === 'localhost' ? undefined : `.${domain}`,
					sameSite: 'lax',
					maxAge: 600, // 10 minutes
					path: '/'
				})
			}
		}

		// if (!request.session)
		// 	fastify.log.error('No session found on /submit/:provider request')

		// // Save session and wait for it to complete before redirecting
		// try {
		// 	await new Promise<void>((resolve, reject) => {
		// 		request.session.save((err) => {
		// 			if (err) {
		// 				fastify.log.error({ err }, 'Failed to save session before OAuth redirect')
		// 				reject(err)
		// 			} else {
		// 				fastify.log.info({ sessionId: request.session.sessionId }, 'Session saved before OAuth redirect')
		// 				resolve()
		// 			}
		// 		})
		// 	})
		// 	return reply.redirect(`/connect/${provider}`)
		// } catch (err) {
		// 	return reply.redirect('/', 500)
		// }

		return reply.redirect(`/connect/${provider}`)


	})

	// /auth/callback - Our custom callback route - receives all OAuth responses
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
			fastify.log.error({ provider: grantSession.provider, response: grantSession.response }, 'Failed to extract grant data')
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

		// Remember which provider was last used
		reply.setCookie('last_provider', grantData.provider, {
			httpOnly: false, // Allow client-side access for UI updates
			secure: domain !== 'localhost',
			domain: hostname,
			sameSite: 'lax',
			maxAge: 365 * 24 * 60 * 60, // 1 year in seconds
			path: '/'
		})

		// Build redirect URL from temporary cookies
		const redirectHost = request.cookies.redirect_host
		const redirectPath = request.cookies.redirect_path
		let redirectUrl
		const protocol = domain === 'localhost' ? 'http' : 'https'
		if (redirectHost && validateRedirectHost(redirectHost)) {
			redirectUrl = `${protocol}://${redirectHost}${redirectPath || '/'}`
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