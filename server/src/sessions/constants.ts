/**
 * Session cookie lifetime in seconds (90 days)
 * The cookie persists in the browser for this duration
 * 
 * Beyond this period, the user must re-authenticate
 * via the sign-in flow
 */
export const SESSION_COOKIE_MAX_AGE_DAYS = 90

/**
 * Session validity period in days (7 days)
 * After this period, the user must re-authenticate via transparent OAuth
 * 
 * Between this period and the cookie max age, the session is valid
 * and the user can be re-authenticated without user interaction
 */
export const SESSION_VALIDITY_DAYS = 7
