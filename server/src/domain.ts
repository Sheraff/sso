const ORIGIN = process.env.ORIGIN!
if (!ORIGIN) throw new Error("ORIGIN not set in environment")

export const hostname = new URL(ORIGIN).hostname

export const domain = hostname === "localhost" ? hostname : hostname.split(".").slice(-2).join(".")

/**
 * Validates that a redirect host ends with the base domain.
 * Prevents open redirect vulnerabilities.
 * 
 * @param host - The host to validate (e.g., "app.example.com")
 * @returns true if host is valid, false otherwise
 */
export function validateRedirectHost(host: string): boolean {
	if (domain === "localhost") {
		return host === "localhost"
	}
	try {
		const url = new URL(`http://${host}`)
		return url.host.endsWith(`.${domain}`)
	} catch {
		return false
	}
}

export { ORIGIN }