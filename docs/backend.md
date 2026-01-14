# Backend Documentation (NestJS)

## Authentication and Authorisation

### JWT Token Flow

1. User logs in via `/auth/login` endpoint with credentials
2. Backend validates credentials against PostgreSQL database
3. On success, generates JWT token with user payload
4. Token is returned to the client application
5. Client includes token in `Authorization: Bearer <token>` header for subsequent requests
6. Backend validates token on protected routes using JWT strategy

Client-side token storage strategy is intentionally left to the consuming application; clients should store tokens securely and handle refresh/logout flows appropriately.

### JWT Configuration

- **Algorithm**: HS256 (HMAC with SHA-256)
- **Secret**: Loaded from AWS Secrets Manager (`jwtSecret`) via `SecretsService`
- **Expiry**: `AUTH_TOKEN_EXPIRES_IN` (seconds)
- **Payload**: Typically includes user ID, username, roles

> TODO: Confirm and document the exact JWT payload fields and the production expiry values.

### Refresh tokens

- Refresh token `jti` (JWT ID) values are persisted in the database as `jwtId`
- Token revocation is high-performance $O(1)$ based on database indexing of `jwtId` and `userId`
- Tokens can be revoked (marked `isRevoked=true`)
- A scheduled cleanup deletes expired or revoked refresh tokens daily at 3am

> TODO: Confirm the cron schedule and timezone used for refresh-token cleanup (and whether it should be UTC).

### Token Validation

- All protected routes use `@UseGuards(JwtAuthGuard)`
- Invalid or expired tokens return 401 Unauthorised
- The JWT strategy extracts user information from token and attaches to request object

## Middleware Execution Order

Middleware executes in the following order:

1. **CORS**: Enabled first so preflight requests are not blocked
2. **trust proxy**: Set when not running in `local`
3. **Body parsers**: JSON and URL-encoded payload limits
4. **Content-Length guard**: Rejects oversized requests early
5. **Client IP middleware**: Populates `req.clientIp` from Cloudflare/forwarded headers
6. **Nonce middleware**: Generates a per-request nonce
7. **ValidationPipe**: Whitelisting + transform + forbid non-whitelisted
8. **Cache + CSP headers**: Adds no-store cache headers and a CSP using the nonce
9. **Helmet**: Security headers (Helmet CSP disabled because CSP is set manually)
10. **Rate limiting**: `express-rate-limit` (auth routes first, expensive routes next, then method-based defaults)
11. **Route handlers**: Controllers, guards, interceptors

### Client IP Middleware

**Critical Implementation Detail:**

The `clientIpMiddleware` extracts the real client IP address from Cloudflare headers, prioritising `CF-Connecting-IP` over `X-Forwarded-For`.

**Why This Matters:**

- Cloudflare proxies all requests, so `req.ip` would show Cloudflare's IP, not the actual client
- `CF-Connecting-IP` is the authoritative header from Cloudflare containing the real client IP
- `X-Forwarded-For` can be spoofed or contain multiple IPs; only trust it when from Cloudflare
- Proper client IP is essential for rate limiting, logging, and security

**Implementation:**

```typescript
// Extract in this priority order:
1. CF-Connecting-IP (Cloudflare's authoritative header)
2. X-Forwarded-For (fallback, take first IP)
3. req.ip (last resort)
```

**Testing:**

- In production, `CF-Connecting-IP` should always be present
- In local development, fallback headers will be used
- Verify logs show correct client IPs, not Cloudflare infrastructure IPs

## Logging Strategy

### Logger Implementation

The application uses NestJS's built-in `Logger` class throughout controllers, services, guards, and middleware.

### Log Levels

- `verbose`: All logs including very detailed information
- `debug`: Detailed information for debugging (e.g., method entry/exit, variable values)
- `log`: General information (e.g., successful operations, state changes)
- `warn`: Warning conditions that should be reviewed (e.g., deprecated usage, recoverable errors)
- `error`: Error conditions (e.g., exceptions, failed operations)

### Environment-Based Logging

The `LOG_LEVEL` environment variable controls logging verbosity:

- **Development** (`LOG_LEVEL=debug`): All log levels are output
- **Production** (`LOG_LEVEL=log`): Only warnings and errors are output
- This reduces noise in production while maintaining critical error visibility

> TODO: Confirm the production `LOG_LEVEL` value actually set in Render.

### Logging Guidelines

- **Controllers**: Log incoming requests and their outcomes
- **Services**: Log business logic operations and external service calls
- **Guards**: Log authentication/authorisation decisions
- **Middleware**: Log IP extraction, rate limiting decisions
- **Error Handlers**: Always log errors with full context

### Sensitive Data

**Never log:**

- Passwords (plaintext or hashed)
- JWT tokens
- API keys or secrets
- Full credit card numbers
- Personal identification numbers

## Startup Notes

### Database Initialisation (TypeORM)

- The application uses NestJS + `TypeOrmModule.forRootAsync(...)` to initialise the database connection.
- Avoid manually creating/initialising a second `DataSource` during bootstrap, as it can duplicate connection pools/metadata and increase baseline memory usage.

### Startup Diagnostics

For investigating intermittent startup memory jumps (especially in production), you can enable lightweight memory/timing logs during bootstrap:

- Set `STARTUP_DIAGNOSTICS=true` to log `rss`, `heapUsed`, `heapTotal`, `external`, and `arrayBuffers` at key stages (bootstrap start, after app creation, after module init, and after listening).
- Leave unset/false for normal operation.

## Rate Limiting

### Global Rate Limiting

Rate limiting is implemented using `express-rate-limit` and stored in **Redis** via `rate-limit-redis`. Each category of rate limiting uses a unique Redis key prefix to prevent collisions.

Default limits (15 minute windows):

- GET/HEAD (read): 1500 per window (only failed requests are counted)
- POST/PUT/PATCH/DELETE (write): 200 per window

### Endpoint-Specific Rate Limiting

Stricter limits are applied to specific route groups before the method-based limiter:

- Auth endpoints (15 minute window): 20 per window
- Expensive endpoints (15 minute window): 50 per window

### Implementation Details

**Redis Store:**

- Each rate limiter creates a dedicated `RedisStore` instance to avoid store reuse errors
- Store uses type-safe `sendCommand` implementation with proper TypeScript typing (`RedisReply`)
- Redis commands are executed via `ioredis` client's `call` method

**Key Generation:**

- Rate limit keys are generated from client IP addresses
- IPv4 addresses: Used directly (e.g., `192.0.2.1`)
- IPv6 addresses: `/64` subnet prefix used for keying (common recommendation for IPv6 subnetting)
- IPv6-mapped IPv4 addresses (`:ffff:192.0.2.1`) are normalized to IPv4 by `clientIpMiddleware` before reaching rate limiter

**IP Address Resolution:**

Client IP is extracted in priority order:

1. `CF-Connecting-IP` (Cloudflare's authoritative header)
2. First entry from `X-Forwarded-For`
3. Express `req.ip`

### Rate Limit Headers

Responses include standard rate limit headers from `express-rate-limit` (RFC-style `RateLimit-*` headers), plus `Retry-After` on 429 responses.

### 429 Errors

When rate limit is exceeded:

- HTTP 429 Too Many Requests response
- Response includes `Retry-After` in seconds
- Check logs for IP addresses hitting limits frequently

### Tuning Rate Limits

If legitimate traffic is being throttled:

1. Review rate limit settings in `main.ts`
2. Consider increasing `max` and/or `windowMins`
3. Balance security (DDoS protection) with usability
4. Monitor 429 error rates in production logs

## File Upload Endpoints

### Upload Configuration

File uploads use Multer middleware with shared limits in `src/shared/constants/file-upload.constants.ts` and per-endpoint interceptor limits.

### Centralised Multer Limits

**File Size Limits:**

- Default file size limit is 10 MB (`DEFAULT_MULTER_LIMITS.fileSize`)
- This can be overridden per environment using `MAX_IMAGE_SIZE_IN_BYTES`

**Field Limits:**

- `files`: 1
- `fields`: 0
- `parts`: 2
- `headerPairs`: 50

### Allowed MIME Types

Only the following image types are accepted:

- `image/png`
- `image/jpg`
- `image/jpeg`

### Validation Rules

1. **MIME Type Check**: Multer checks `mimetype` field
2. **File Extension Check**: Additional validation against allowed extensions
3. **File Size Check**: Enforced by Multer limits
4. **Virus scanning**: Uploads are scanned via Cloudmersive before being stored

### Upload Endpoints

- **User Profile Image**: `POST /user/update-profile-pic` (authenticated)
- **Character Image**: `POST /character/:id/profile-image` (authenticated, ownership check)

## Image Upload Service

### Cloudflare Images Integration

The `ImageUploadsService` handles uploading images to Cloudflare Images.

**Flow:**

1. File received via Multer
2. Validation checks performed
3. File uploaded to Cloudflare Images API
4. Cloudflare returns Image ID
5. Image ID stored in database
6. Client can retrieve image via Cloudflare CDN URL

### R2 and Cloudflare Images

**R2 (Object Storage):**

- Used for original file storage (if configured)
- S3-compatible API
- Lower cost than Cloudflare Images for storage

**Cloudflare Images:**

- Optimised delivery and transformation
- Automatic format conversion (WebP, AVIF)
- Resizing and cropping on-the-fly
- Global CDN delivery

**Combined Usage:**

- Original files may be stored in R2
- Cloudflare Images serves optimised versions
- Image ID links both systems

### Image URL Format

**Cloudflare Images URL:**

```
<CLOUDFLARE_CDN_ROOT_URL>/cdn-cgi/imagedelivery/<CLOUDFLARE_IMAGES_HASH>/<IMAGE_ID>/<VARIANT>
```

- `CLOUDFLARE_CDN_ROOT_URL`: Base Cloudflare URL
- `CLOUDFLARE_IMAGES_HASH`: Cloudflare Images hash
- `IMAGE_ID`: Unique identifier returned by Cloudflare
- `VARIANT`: Transformation variant (e.g., `public`)

> TODO: Replace placeholders with your real delivery root/hash (and list the variants the frontend should use).

## Guards

### Available Guards

- **JwtAuthGuard**: Validates JWT token, ensures user is authenticated
- **RolesGuard**: Checks user has required role(s) for endpoint
- **OwnershipGuard**: Ensures user owns the resource they're accessing (e.g., their own character)

### Guard Usage

Guards are applied using decorators:

```typescript
@UseGuards(JwtAuthGuard)              // Authentication required
@UseGuards(JwtAuthGuard, RolesGuard)  // Authentication + role check
@Roles('admin')                       // Requires 'admin' role
```

## Caching

Document any caching strategies here (e.g., Redis, in-memory cache, HTTP caching headers).

**Current Status:** Review code to determine if caching is implemented.

## NPM Scripts

### Development

- `npm run start`: Start application
- `npm run start:dev`: Start with hot-reload and watch mode
- `npm run start:debug`: Start with debugging enabled

### Building

- `npm run build`: Compile TypeScript to JavaScript for production
- `npm run format`: Format code with Prettier
- `npm run lint`: Run ESLint checks

### Testing

- `npm run test`: Run unit tests
- `npm run test:watch`: Run tests in watch mode
- `npm run test:cov`: Run tests with coverage report
- `npm run test:debug`: Run tests with debugging
- `npm run test:mutation`: Run Stryker mutation tests
- `npm run test:mutation:dry`: Dry run mutation tests (no actual mutations)

### Database

- `npm run migration:create`: Create a new migration file
- `npm run migration:generate`: Generate migration from entity changes
- `npm run migration:run`: Execute pending migrations
- `npm run migration:revert`: Revert last migration

### Other

- `npm run typeorm`: Run TypeORM CLI commands directly
