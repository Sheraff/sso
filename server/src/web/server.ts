import Fastify from 'fastify'
import grant from "grant"
import { grantOptions, getGrantData, type RawGrant } from "#/providers/index.ts"

const PORT = process.env.PORT!
if (!PORT) throw new Error("PORT not set in environment")

const fastify = Fastify({
	logger: true
})

fastify.get('/', function (request, reply) {
	/**
	 * Serve a web page that allows
	 * - signing in with OAuth providers (available providers from grantOptions)
	 * - signing up with invitation code (step 1 of invitation flow) + oauth (step 2)
	 * 
	 * On successful authentication
	 * - set a session cookie on `domain` (from domain.ts), shared across subdomains
	 * - redirects to ?host=...&path=...
	 * 
	 * `host` must end with `.${domain}` (from domain.ts)
	 * 
	 */
	reply.send({ hello: 'world' })
})

void fastify.register(
	grant.default.fastify({
		defaults: {
			origin: process.env.ORIGIN,
			transport: "session",
			state: true,
			prefix: "/api/oauth/connect",
			callback: "/api/oauth/finalize",
		},
		...grantOptions,
	})
)

export function webServer() {
	fastify.listen({ port: Number(PORT) }, function (err, address) {
		if (err) {
			fastify.log.error(err)
			process.exit(1)
		}
		// Server is now listening on ${address}
	})
}