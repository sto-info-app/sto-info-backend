# Security Documentation

## CORS Configuration

### Purpose

CORS (Cross-Origin Resource Sharing) controls which domains can make requests to the backend API from browsers.

### Configuration Location

CORS is configured in `src/main.ts`.

### Development CORS Settings

**Allowed Origins:**

```typescript
origin: [
  'http://localhost:4200', // Angular dev server
  'https://dev.startrekonline.info', // Development frontend
];
```

**Development Environment:**

- `NODE_ENV=dev`
- CORS allows both localhost and dev subdomain
- Credentials: `true` (allows cookies/auth headers)

> TODO: Confirm the full list of allowed origins for dev (including any additional hostnames like preview/staging/admin tools).

### Production CORS Settings

**Allowed Origins:**

```typescript
origin: [
  'https://startrekonline.info', // Production frontend
];
```

**Production Environment:**

- `NODE_ENV=prod`
- CORS restricted to production domains only
- Credentials: `true`

> TODO: Confirm the production allowed origins list (and whether `www.` or additional subdomains should be included).

### CORS Headers

**Allowed Headers:**

- `Origin`
- `X-Requested-With`
- `Content-Type`
- `Accept`
- `Authorization`

### Troubleshooting CORS Errors

**Error:** "No 'Access-Control-Allow-Origin' header is present"

**Causes:**

1. Frontend origin not in allowed origins list
2. Request sent without credentials when required
3. Preflight OPTIONS request failing

**Solutions:**

1. Add frontend origin to CORS configuration
2. Ensure frontend sends `withCredentials: true` in HTTP requests
3. Check backend logs for OPTIONS request failures

**Testing:**

- Use browser DevTools Network tab to inspect CORS headers
- Check `Access-Control-Allow-Origin` in response headers
- Verify `Origin` in request headers matches allowed list

## File Upload Security

### Allowed MIME Types

**Permitted:**

- `image/png`
- `image/jpg`
- `image/jpeg`

### Why Block SVG?

**Security Risk:**

SVG files can contain embedded JavaScript, making them a vector for:

- Cross-Site Scripting (XSS) attacks
- Malware injection
- Social engineering attacks

**Recommendation:**

Always block SVG uploads unless you have a specific need and implement SVG sanitisation.

### File Upload Size Limits

**Maximum File Size:** Controlled by `MAX_IMAGE_SIZE_IN_BYTES` (defaults to 10 MB if not set)

**Rationale:**

- Prevents excessive storage usage
- Limits impact of denial-of-service attacks
- Ensures reasonable upload times for users
- Cloudflare Images has size limits (check current limit)

> TODO: Confirm the current Cloudflare Images upload size limit and ensure `MAX_IMAGE_SIZE_IN_BYTES` is set accordingly.

**Enforcement:**

- Frontend validation (immediate user feedback)
- Backend Multer validation (defence in depth)
- Both should use the same limit for consistency

### File Upload Validation

**Defence in Depth:**

1. **Frontend Validation**: Check MIME type and size before upload
2. **Backend Validation**: Multer checks MIME type and size
3. **Virus scanning**: Uploads are scanned via Cloudmersive before being stored

**Magic Bytes Validation:**

Consider checking file magic bytes (file signature) to verify file type independently of MIME type and extension (prevents type spoofing).

> TODO: Decide whether to implement magic-bytes validation (and document the chosen approach/library if implemented).

### MIME Type Constants

**Centralised Constants:**

File upload limits and allowed MIME types are defined in:

```
src/shared/constants/file-upload.constants.ts
```

**Benefits:**

- Single source of truth
- Easy to update across all upload endpoints
- Consistent validation rules

## Password Security

### Hashing Algorithm

**Bcrypt:**

- Industry-standard password hashing
- Computationally expensive (resists brute force)
- Salted automatically (prevents rainbow table attacks)

**Salt Rounds:**

- Document current salt rounds (typically 10-12)

> TODO: Set and document the actual `AUTH_SALT_ROUNDS` used in each environment.

- Higher rounds = more secure but slower
- Balance security with performance

**Never Store Plaintext:**

- Passwords are always hashed before storage
- Even admins cannot retrieve plaintext passwords
- Password reset required if user forgets password

### Password Requirements

**Document password policy:**

- Minimum length (e.g., 8 characters)
- Complexity requirements (uppercase, lowercase, numbers, symbols)
- Prevent common passwords (e.g., "password123")

> TODO: Confirm and document the real password policy enforced by the app (validation rules, error messages, and any common-password blocking).

## JWT Security

### JWT Secret

JWT signing secrets are loaded from AWS Secrets Manager via `SecretsService`.

**Requirements:**

- Long random string (at least 256 bits)
- Rotate on suspected compromise
- Never commit to version control

### JWT Secret Rotation

**Current Policy:**

Document JWT secret rotation policy (e.g., rotate every 6 months, or on suspected compromise).

> TODO: Write down the real rotation policy and who owns the process (including incident steps on suspected compromise).

**Rotation Process:**

1. Generate new secret
2. Update the AWS Secrets Manager secret value (`jwtSecret`)
3. Redeploy the backend so it picks up the updated secret
4. All existing tokens become invalid (users forced to re-login)
5. Consider grace period with dual-secret validation for smooth transition

### Token Expiry

**Expiry Duration:**

Document current token expiry (e.g., 1 hour, 24 hours).

> TODO: Record the current `AUTH_TOKEN_EXPIRES_IN` and `AUTH_REFRESH_TOKEN_EXPIRES_IN` values used in prod.

**Security Considerations:**

- Shorter expiry = more secure (limits window for token theft)
- Longer expiry = better UX (less frequent logins)
- Implement refresh tokens for long-lived sessions without compromising security

## Rate Limiting

### Global Rate Limits

**Configuration:**

- Implemented via `express-rate-limit` in `src/main.ts`
- Standard window length is 15 minutes
- GET/HEAD (read): 1500 per window (only failed requests are counted)
- POST/PUT/PATCH/DELETE (write): 200 per window

**Purpose:**

- Prevent brute force attacks (login, password reset)
- Mitigate denial-of-service attacks
- Protect server resources

### Endpoint-Specific Rate Limits

**Login Endpoint:**

- Auth endpoints are rate limited as a group: 20 per 15 minutes
- Auth endpoints include `/auth/login`, `/auth/register`, `/auth/refresh`, and password reset flows

**File Upload Endpoints:**

- Upload/search endpoints are rate limited as a group: 50 per 15 minutes

### Rate Limit Bypass

**Considerations:**

- Authenticated users might have higher limits
- Trusted IPs (e.g., internal services) might bypass limits
- Document any bypass rules

> TODO: Document any rate-limit bypass rules (trusted IPs, admin tooling, health checks) and where they are configured (Cloudflare vs backend).

## Proxy, client IP, and IPv6

- The backend runs behind Cloudflare; `req.ip` will reflect Cloudflare unless proxy trust is configured
- The backend sets Express `trust proxy` to `TRUST_PROXY_HOPS` when not running in `local`
- Client IP is derived in this order: `CF-Connecting-IP`, first `X-Forwarded-For`, then `req.ip`
- IPv6-mapped IPv4 values like `::ffff:192.0.2.1` are normalised to IPv4

## HTTP security headers

- Backend sets strict no-cache/no-store headers on API responses
- CSP is set explicitly with a per-request nonce; Helmet CSP is disabled to avoid conflicts

## Audit and retention

- Audit tables exist for entity change tracking and login attempts
- A daily job deletes audit and login attempt records older than `AUDIT_DATA_NUKE_THRESHOLD_DAYS`
- A daily job nulls `ipAddress` for audit and login attempt records older than `AUDIT_IP_NUKE_THRESHOLD_DAYS`

### Monitoring Rate Limits

**429 Errors:**

- Log all rate limit violations with client IP
- Monitor for patterns (DDoS attacks, misconfigured clients)
- Adjust limits if legitimate traffic is being blocked

## Logging Sensitive Data

### Never Log:

- **Passwords**: Plaintext or hashed
- **JWT Tokens**: Full token strings
- **API Keys/Secrets**: Cloudflare tokens, R2 credentials
- **Credit Card Numbers**: If payment processing added
- **Personal Identification Numbers**: Social security, passport, etc.

### What to Log:

- User IDs (not names or emails in high-volume logs)
- Request paths and methods
- Error messages and stack traces
- Client IPs (from `CF-Connecting-IP`)
- Rate limit violations
- Authentication failures (without password values)

### Log Levels and Security

**Production (`LOG_LEVEL=warn`):**

- Reduces log volume
- Minimises risk of sensitive data in logs
- Still captures errors and warnings

**Development (`LOG_LEVEL=debug`):**

- More verbose for debugging
- May include more request details
- Never use in production

## API Key Management

### Cloudflare API Token

**Permissions:**

- Cloudflare Images: Read/Write
- R2 Storage: Read/Write
- Minimum required permissions only

**Security:**

- Store in environment variables, never in code
- Rotate periodically (e.g., every 6 months)
- Revoke immediately if compromised

### R2 Access Credentials

**Access Key ID and Secret:**

- S3-compatible credentials
- Store in environment variables
- Rotate periodically

**Least Privilege:**

- Credentials should only have access to specific bucket
- Read/write only, no delete if possible (or isolate delete permissions)

## HTTP Security Headers

### Helmet Middleware

**Applied in `main.ts`:**

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` or `SAMEORIGIN`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=...` (HSTS)

**Purpose:**

- Prevent MIME type sniffing attacks
- Prevent clickjacking
- Enable browser XSS filters
- Enforce HTTPS

### Content Security Policy (CSP)

**Current Status:**

Document if CSP is configured (check Helmet configuration or Cloudflare Page Rules).

**Recommendation:**

Implement CSP to prevent XSS attacks by controlling resource loading.

## Security Considerations

### Attack Vectors Addressed

- **SQL Injection**: TypeORM parameterised queries
- **XSS**: Input sanitisation, CSP headers, no SVG uploads
- **CSRF**: Token-based if using cookies (check implementation)
- **Brute Force**: Rate limiting on login endpoints
- **DDoS**: Cloudflare edge protection + backend rate limiting
- **File Upload Attacks**: MIME type validation, size limits, SVG blocking

### Known Security Considerations

**Document any known security limitations or areas for improvement:**

- Token refresh strategy (if not implemented, plan to implement)
- Two-factor authentication (if not implemented, consider for future)
- Audit logging (track sensitive operations for security review)
- Dependency vulnerability scanning (npm audit, Dependabot)
