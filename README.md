# SSO - Local OAuth Authentication System

A Single Sign-On (SSO) authentication system that enables multiple Node.js applications running on the same machine to share user authentication via Inter-Process Communication (IPC).

## Features

- 🔐 **OAuth 2.0 Authentication** - Support for many providers (currently GitHub, Google, Discord, Spotify, Twitch)
- 🔒 **Invite-Only Registration** - Human-readable 3-word invitation codes
- 🚀 **IPC-Based Architecture** - Fast local authentication via Unix domain sockets
- 🔑 **Multi-Provider Accounts** - Link multiple OAuth providers to one user identity
- 🍪 **Shared Sessions** - Session cookies work across subdomains
- 🔐 **AES-256-GCM Encryption** - Industry-standard encryption for sensitive data
- 📦 **Monorepo Structure** - Separate server and client packages

## Architecture

This system consists of two main components:

### Server (`@sso/server`)
- Fastify-based web server handling OAuth flows
- IPC server for authentication validation
- SQLite database for session/user management
- OAuth integration via Grant middleware

### Client (`@sso/client`)
- Lightweight IPC client library for Node.js applications
- Validates session cookies via the SSO server
- Automatic reconnection handling

## How It Works

1. **User accesses protected application** → Client sends session cookie to SSO server via IPC
2. **Authentication check** → Server validates session against database
3. **If unauthenticated** → Server responds with redirect URL to SSO interface
4. **User signs in** → User enters invitation code (for signup) or selects OAuth provider
5. **OAuth flow** → Grant middleware handles authorization with provider
6. **Account creation/linking** → Database stores user identity and provider connection
7. **Session creation** → Encrypted session cookie set on shared domain
8. **Redirect back** → User returns to original application with active session
9. **Subsequent requests** → Fast IPC validation without OAuth flow

## Configuration

### Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `PORT` | ✅ Yes | HTTP server port | `3000` |
| `ORIGIN` | ✅ Yes | Application origin URL for OAuth callbacks | `https://auth.example.com` |
| `DATABASE_PATH` | ✅ Yes | SQLite database file path | `./data/sso.db` |
| `ENCRYPTION_KEY` | ✅ Yes | Strong encryption key for AES-256-GCM | Min 32 characters |
| `GITHUB_CLIENT_ID` | ⚠️ Optional* | GitHub OAuth app ID | `Iv1.abc123...` |
| `GITHUB_CLIENT_SECRET` | ⚠️ Optional* | GitHub OAuth app secret | `ghp_abc123...` |
| `GOOGLE_CLIENT_ID` | ⚠️ Optional* | Google OAuth client ID | `123456789.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | ⚠️ Optional* | Google OAuth client secret | `GOCSPX-...` |
| `DISCORD_CLIENT_ID` | ⚠️ Optional* | Discord OAuth app ID | `123456789012345678` |
| `DISCORD_CLIENT_SECRET` | ⚠️ Optional* | Discord OAuth app secret | `abc123...` |
| `SPOTIFY_CLIENT_ID` | ⚠️ Optional* | Spotify OAuth client ID | `abc123...` |
| `SPOTIFY_CLIENT_SECRET` | ⚠️ Optional* | Spotify OAuth client secret | `abc123...` |
| `TWITCH_CLIENT_ID` | ⚠️ Optional* | Twitch OAuth client ID | `abc123...` |
| `TWITCH_CLIENT_SECRET` | ⚠️ Optional* | Twitch OAuth client secret | `abc123...` |

*At least one OAuth provider must be fully configured (both ID and secret).

### Security Best Practices

- **Encryption Key**: Use a strong, randomly generated key (min 32 characters). Generate with: `openssl rand -base64 32`
- **Database**: Ensure `DATABASE_PATH` directory has appropriate permissions (not world-readable)
- **HTTPS**: In production, always use HTTPS for `ORIGIN` to protect OAuth flows
- **Secrets**: Never commit `.env` file to version control

## OAuth Provider Setup

Each OAuth provider requires you to create an application/client in their developer portal and configure the redirect URI.

### Redirect URI Format

All providers use the same callback URL pattern:

```
{ORIGIN}/api/oauth/connect/{provider}/callback
```

For example, with `ORIGIN=https://auth.example.com`:
- GitHub: `https://auth.example.com/api/oauth/connect/github/callback`
- Google: `https://auth.example.com/api/oauth/connect/google/callback`
- Discord: `https://auth.example.com/api/oauth/connect/discord/callback`
- Spotify: `https://auth.example.com/api/oauth/connect/spotify/callback`
- Twitch: `https://auth.example.com/api/oauth/connect/twitch/callback`

## Database Schema

The system uses SQLite with two main tables:

### `users` Table
```sql
CREATE TABLE users (
  id TEXT NOT NULL PRIMARY KEY,
  email TEXT NOT NULL
);
```

- **id**: Unique user identifier (UUID)
- **email**: User's primary email address

### `accounts` Table
```sql
CREATE TABLE accounts (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, provider, provider_user_id)
);
```

- **id**: Unique account identifier (UUID)
- **user_id**: Reference to user
- **provider**: OAuth provider name (`github`, `google`, `discord`, `spotify`, `twitch`)
- **provider_user_id**: User's ID from the OAuth provider
- **created_at**: Account linking timestamp

### Multi-Provider Account Linking

Users can link multiple OAuth providers to a single account. For example:
- User signs up with GitHub
- Later links their Google account
- Both providers authenticate to the same user identity

The `UNIQUE (user_id, provider, provider_user_id)` constraint prevents duplicate provider linkages.

## Invitation System

The system uses an **invite-only registration model** to control user signups.

### How Invitation Codes Work

Invitation codes are **human-readable 3-word combinations** generated from a curated list of 5-letter words. Examples:
- `apple crane delta`
- `frost lemon river`
- `night ocean piano`

### Code Generation

The `generateCode()` function:
1. Reads 5-letter words from `server/src/invitations/5-letter-words.txt`
2. Randomly selects 3 unique words
3. Checks against existing codes to prevent collisions
4. Returns space-separated word combination

### Signup Flow

1. **Step 1: Invitation Validation**
   - User navigates to SSO interface
   - Enters invitation code
   - System validates code exists and is unused

2. **Step 2: OAuth Authentication**
   - User selects OAuth provider (GitHub, Google, etc.)
   - Completes OAuth flow
   - Account is created and linked to provider
   - Invitation code is marked as used

### Administrative Tasks

**Generating Invitation Codes** (requires database access):

TODO: add `pnpm invite` script in package.json to generate and store codes
1. import client
2. call server through IPC to ask for new code
3. log generated code to the console
4. exit

## Client API Usage

The `@sso/client` package provides the `createSsoClient()` function for integrating SSO into your Node.js applications.

### Installation

```bash
pnpm add @sso/client
```

### Basic Usage

```typescript
import { createSsoClient } from '@sso/client'

const sso = createSsoClient('my-app')

// Check authentication
const result = await sso.checkAuth(sessionCookie)

if (result.authenticated) {
  console.log('User:', result.user)
  // { id: '...', email: 'user@example.com' }
} else {
  console.log('Redirect to:', result.redirect)
  // 'http://localhost:3000/?host=myapp.example.com&path=/dashboard'
}
```

### Client API Reference

#### `createSsoClient(name: string): SsoClient`

Creates an SSO client instance that connects to the SSO server via IPC.

**Parameters:**
- `name` (string): Unique identifier for your application (e.g., `'my-app'`, `'api-server'`)

**Returns:** `SsoClient` instance

**Example:**
```typescript
const sso = createSsoClient('my-app')
```

The client automatically:
- Generates a unique IPC client ID: `{name}-{random}`
- Connects to the SSO server via Unix domain socket
- Handles reconnection on disconnect (1000ms retry interval)

#### `ssoClient.checkAuth(cookie?: string): Promise<AuthCheckResult>`

Validates a session cookie and returns authentication status.

**Parameters:**
- `cookie` (string, optional): Session cookie value from incoming request

**Returns:** `Promise<AuthCheckResult>`

**AuthCheckResult Types:**

```typescript
// Authenticated user
{
  authenticated: true,
  user: {
    id: string,        // User UUID
    email: string      // User email
  },
  cookie?: string      // Updated cookie if session was refreshed
}

// Unauthenticated - needs redirect
{
  authenticated: false,
  redirect: string    // URL to redirect user to SSO interface
}
```

### Integration Examples

#### Express.js Middleware

```typescript
import express from 'express'
import { createSsoClient } from '@sso/client'

const app = express()
const sso = createSsoClient('express-app')

// Authentication middleware
async function requireAuth(req, res, next) {
  const sessionCookie = req.cookies['sso_session']
  
  try {
    const result = await sso.checkAuth(sessionCookie)
    
    if (result.authenticated) {
      // Update cookie if refreshed
      if (result.cookie) {
        res.cookie('sso_session', result.cookie, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          domain: '.example.com', // Share across subdomains
          sameSite: 'lax'
        })
      }
      
      // Attach user to request
      req.user = result.user
      next()
    } else {
      // Redirect to SSO with return path
      const host = req.hostname
      const path = req.originalUrl
      res.redirect(result.redirect)
    }
  } catch (error) {
    console.error('SSO check failed:', error)
    res.status(500).send('Authentication service unavailable')
  }
}

// Protected route
app.get('/dashboard', requireAuth, (req, res) => {
  res.json({
    message: 'Welcome to your dashboard',
    user: req.user
  })
})

app.listen(3001)
```

#### Fastify Plugin

```typescript
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { createSsoClient } from '@sso/client'

const fastify = Fastify()
const sso = createSsoClient('fastify-app')

// Register cookie plugin
await fastify.register(cookie)

// Authentication decorator
fastify.decorate('authenticate', async (request, reply) => {
  const sessionCookie = request.cookies['sso_session']
  
  try {
    const result = await sso.checkAuth(sessionCookie)
    
    if (result.authenticated) {
      // Update cookie if refreshed
      if (result.cookie) {
        reply.setCookie('sso_session', result.cookie, {
          httpOnly: true,
          secure: true,
          domain: '.example.com',
          sameSite: 'lax'
        })
      }
      
      request.user = result.user
    } else {
      reply.redirect(result.redirect)
    }
  } catch (error) {
    reply.code(500).send({ error: 'Authentication service unavailable' })
  }
})

// Protected route
fastify.get('/api/profile', {
  preHandler: [fastify.authenticate]
}, async (request, reply) => {
  return {
    user: request.user
  }
})

await fastify.listen({ port: 3002 })
```

#### Next.js Middleware (App Router)

```typescript
// middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createSsoClient } from '@sso/client'

const sso = createSsoClient('nextjs-app')

export async function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get('sso_session')?.value
  
  try {
    const result = await sso.checkAuth(sessionCookie)
    
    if (result.authenticated) {
      const response = NextResponse.next()
      
      // Update cookie if refreshed
      if (result.cookie) {
        response.cookies.set('sso_session', result.cookie, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          domain: '.example.com',
          sameSite: 'lax'
        })
      }
      
      // Pass user data to page via header
      response.headers.set('x-user-id', result.user.id)
      response.headers.set('x-user-email', result.user.email)
      
      return response
    } else {
      // Redirect to SSO
      return NextResponse.redirect(result.redirect)
    }
  } catch (error) {
    console.error('SSO check failed:', error)
    return NextResponse.redirect(new URL('/error', request.url))
  }
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/protected/:path*']
}
```

#### GraphQL Context

```typescript
import { ApolloServer } from '@apollo/server'
import { createSsoClient } from '@sso/client'

const sso = createSsoClient('graphql-api')

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    const sessionCookie = req.cookies['sso_session']
    const result = await sso.checkAuth(sessionCookie)
    
    if (!result.authenticated) {
      throw new Error('Unauthenticated')
    }
    
    return {
      user: result.user
    }
  }
})
```

### Advanced Usage Patterns

#### Concurrent Request Handling

The SSO client handles multiple concurrent authentication checks efficiently:

```typescript
import { createSsoClient } from '@sso/client'

const sso = createSsoClient('api-server')

// Multiple simultaneous checks
const results = await Promise.all([
  sso.checkAuth(cookie1),
  sso.checkAuth(cookie2),
  sso.checkAuth(cookie3)
])

results.forEach((result, i) => {
  if (result.authenticated) {
    console.log(`Request ${i}: User ${result.user.email}`)
  } else {
    console.log(`Request ${i}: Redirect to ${result.redirect}`)
  }
})
```

#### Session Refresh Handling

Always check for updated cookies to maintain session freshness:

```typescript
async function authenticateRequest(cookie) {
  const result = await sso.checkAuth(cookie)
  
  if (result.authenticated) {
    // Important: Use the updated cookie if provided
    const sessionCookie = result.cookie || cookie
    
    return {
      user: result.user,
      cookie: sessionCookie
    }
  }
  
  throw new Error('Not authenticated')
}
```

#### Error Handling and Retry Logic

```typescript
async function checkAuthWithRetry(cookie, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await sso.checkAuth(cookie)
      return result
    } catch (error) {
      console.error(`Auth check attempt ${i + 1} failed:`, error)
      
      if (i === retries - 1) {
        // All retries exhausted
        return {
          authenticated: false,
          redirect: `${process.env.SSO_ORIGIN}/?error=service_unavailable`
        }
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100))
    }
  }
}
```

#### Custom Redirect URL Construction

The SSO server constructs redirect URLs based on the requesting application:

```typescript
// Server builds redirect like this:
const redirectUrl = new URL(process.env.ORIGIN)
redirectUrl.searchParams.set('host', requestingHost)
redirectUrl.searchParams.set('path', requestedPath)
// Result: http://localhost:3000/?host=myapp.example.com&path=/dashboard

// After authentication, user is redirected back to:
// http://myapp.example.com/dashboard
```

To customize this behavior in your application:

```typescript
async function requireAuth(req, res, next) {
  const result = await sso.checkAuth(req.cookies['sso_session'])
  
  if (!result.authenticated) {
    // The redirect URL already includes return path
    // Just redirect the user
    res.redirect(result.redirect)
  } else {
    next()
  }
}
```

#### Health Check / Connection Status

```typescript
import { createSsoClient } from '@sso/client'

const sso = createSsoClient('my-app')

// Simple health check
async function checkSsoHealth() {
  try {
    // Attempt auth check with no cookie
    const result = await sso.checkAuth()
    
    // If we get a redirect response, SSO is healthy
    if (!result.authenticated && result.redirect) {
      return { status: 'healthy', message: 'SSO service is running' }
    }
    
    return { status: 'healthy' }
  } catch (error) {
    return {
      status: 'unhealthy',
      message: 'Cannot connect to SSO service',
      error: error.message
    }
  }
}

// Use in health check endpoint
app.get('/health', async (req, res) => {
  const ssoHealth = await checkSsoHealth()
  res.json({
    service: 'my-app',
    sso: ssoHealth
  })
})
```

## Running the System

### Development Mode

**Terminal 1 - Start SSO Server:**
```bash
cd server
pnpm install
pnpm start
```

**Terminal 2 - Test with Client:**
```bash
cd client
pnpm install
pnpm start
```

### Production Mode

```bash
# Build all packages
pnpm -r build

# Start server (use process manager like pm2)
cd server
pm2 start dist/index.js --name sso-server

# Your applications using @sso/client will connect automatically
```

### Development Scripts

The workspace includes helpful scripts:

```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm -r build

# Run type checking
pnpm -r type-check

# Clean build artifacts
pnpm -r clean
```

## Project Structure

```
sso/
├── package.json              # Root workspace configuration
├── pnpm-workspace.yaml       # pnpm workspace definition
├── tsconfig.json             # Shared TypeScript config
├── client/                   # @sso/client package
│   ├── index.ts             # Client library implementation
│   ├── package.json
│   └── tsconfig.json
└── server/                   # @sso/server package
    ├── index.ts             # Server entry point
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── schema.sql       # Database schema
        ├── domain.ts        # Domain extraction for cookies
        ├── encryption.ts    # AES-256-GCM encryption
        ├── invitations/
        │   ├── generateCode.ts      # Invitation code generator
        │   └── 5-letter-words.txt   # Word list
        ├── providers/       # OAuth provider implementations
        │   ├── index.ts     # Provider orchestration
        │   ├── github.ts
        │   ├── google.ts
        │   ├── discord.ts
        │   ├── spotify.ts
        │   └── twitch.ts
        └── web/
            └── server.ts    # Fastify web server
```

## Security Features

### Encryption (AES-256-GCM)

The system uses **AES-256-GCM** (Galois/Counter Mode) for encrypting sensitive data:

- **Algorithm**: `aes-256-gcm` with authenticated encryption
- **Key Derivation**: PBKDF2-SHA512 with random salt (64 bytes)
- **Iterations**: Random between 10,000-99,999 for each encryption
- **IV**: Random 16 bytes per encryption
- **Auth Tag**: 16 bytes for tamper detection

**Encryption Process:**
1. Generate 64-byte random salt
2. Generate 16-byte random IV
3. Random iteration count (5 digits)
4. Derive 32-byte key from `ENCRYPTION_KEY` via PBKDF2
5. Encrypt with AES-256-GCM
6. Extract authentication tag
7. Concatenate: `iteration|salt|iv|tag|ciphertext`
8. Return hex-encoded string

**Security Benefits:**
- Different salt/IV for each encryption prevents pattern analysis
- Authentication tag prevents tampering
- Random iterations increase brute-force difficulty
- PBKDF2 makes key derivation computationally expensive

### Session Cookie Security

Session cookies are shared across subdomains:

```typescript
// Cookie configuration (recommended)
{
  httpOnly: true,           // Prevent JavaScript access
  secure: true,             // HTTPS only (production)
  domain: '.example.com',   // Share across *.example.com
  sameSite: 'lax',         // CSRF protection
  maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
}
```

### Domain Validation

The server validates redirect hosts to prevent open redirect vulnerabilities:

```typescript
// domain.ts extracts root domain from ORIGIN
// localhost → 'localhost'
// app.example.com → 'example.com'

// Redirect host MUST end with this domain
// ✅ myapp.example.com
// ✅ api.example.com
// ❌ evil.com
```

### OAuth Security

- **State parameter**: Enabled for all providers (CSRF protection)
- **Nonce**: Used where supported (OpenID Connect)
- **Transport**: Session-based (server-side storage)
- **HTTPS**: Required in production

## Troubleshooting

### IPC Connection Issues

**Problem**: Client can't connect to SSO server

**Solutions**:
1. Ensure SSO server is running: `ps aux | grep node`
2. Check IPC socket exists (default location varies by OS)
3. Verify both client and server use same `SERVER_ID` (`'world'`)
4. Check file permissions on socket
5. Review logs: `tail -f server/logs/sso.log`

### OAuth Callback Errors

**Problem**: OAuth flow fails with redirect URI mismatch

**Solutions**:
1. Verify `ORIGIN` environment variable matches exactly
2. Check provider settings use correct callback URL format
3. Ensure HTTPS in production (OAuth providers often require it)
4. Check for trailing slashes (don't include in `ORIGIN`)

### Database Lock Issues

**Problem**: `database is locked` error

**Solutions**:
1. WAL mode should prevent this - verify: `PRAGMA journal_mode;` returns `wal`
2. Check no other process has exclusive lock
3. Ensure `DATABASE_PATH` directory is writable
4. Verify SQLite version supports WAL mode

### Session Not Shared Across Subdomains

**Problem**: Cookie not visible to other subdomains

**Solutions**:
1. Verify cookie domain starts with `.` (e.g., `.example.com`)
2. Check all apps use same root domain
3. Ensure all apps use HTTPS (cookies with `secure` flag)
4. Verify `domain.ts` extracts correct root domain from `ORIGIN`

## Current Implementation Status

### ✅ Completed Features

- OAuth provider integrations (GitHub, Google, Discord, Spotify, Twitch)
- Database schema with multi-provider support
- AES-256-GCM encryption system
- Invitation code generation
- IPC infrastructure (server and client)
- Web server skeleton with Grant middleware
- Type-safe OAuth response validation (Valibot)
- Domain extraction for cookie sharing
- Automatic database initialization

### 🚧 In Progress / Planned

- **Authentication UI**: Root `/` route currently returns stub response
- **Session Management**: Cookie creation, validation, and refresh logic
- **IPC Authentication Handler**: Currently echoes messages, needs full implementation
- **Client Library**: `createSsoClient()` function needs to be exported and completed
- **Invitation Flow**: UI for entering invitation codes and validation
- **Host Validation**: Redirect URL security checks
- **Error Handling**: Comprehensive error handling and user feedback
- **Testing**: Unit and integration tests
- **Documentation**: API documentation and examples

### Known Limitations

1. **No UI**: Web interface is not implemented (returns `{ hello: 'world' }`)
2. **Client Export**: `createSsoClient` is defined but not exported from `@sso/client`
3. **Session Logic**: Session creation/validation not implemented
4. **Invitation Storage**: Database schema doesn't include `invitations` table
5. **Production Hardening**: Needs rate limiting, proper logging, monitoring

## Contributing

This is currently a work-in-progress project. Key areas for contribution:

1. **Web UI**: Implement authentication interface with OAuth provider selection
2. **Session Management**: Implement secure session creation and validation
3. **Client Library**: Complete `SsoClient` implementation
4. **Testing**: Add comprehensive test coverage
5. **Documentation**: Expand examples and use cases

## License

[Add your license here]

## Support

[Add support information here]
