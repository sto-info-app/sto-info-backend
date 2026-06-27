# Security Documentation

This document outlines the security architecture and procedures for the `sto-info-backend`. The project aims to meet **OpenSSF Best Practices Silver** level (and Gold where practical) to ensure high standards of software supply chain security and application hardening.

### Dependency Overrides

This repository uses `npm overrides` in `package.json` to address security issues that originate in transitive dependencies where upgrading a top-level package is not yet possible or would require a breaking change.

**General removal checklist** (apply to any override before removing it):

1. Remove the entry from the `overrides` block in `package.json`.
2. Run `npm install` to regenerate `package-lock.json`.
3. Run `npm audit --omit=dev --audit-level=high` — this is the same gate used by `npm run verify` in CI.
4. Run `npm run test:cov` to confirm coverage tooling is unaffected.
5. If either check fails, restore the override and track the upstream fix instead.

Overrides reduce exposure to known vulnerabilities quickly, but they change the dependency tree independently of what upstream packages tested against. Keep them minimal and prefer removing them as soon as upstream dependencies have caught up.

Current overrides in `package.json`:

```json
"overrides": {
  "lodash": "^4.18.1",
  "ajv": "^8.18.0",
  "form-data": "^4.0.6",
  "js-yaml": "4.2.0",
  "eslint": {
    "ajv": "^6.14.0"
  },
  "mailparser": {
    ".": "^3.9.10",
    "nodemailer": "^9.0.1"
  },
  "anymatch": {
    "picomatch": "^2.3.2"
  },
  "micromatch": {
    "picomatch": "^2.3.2"
  }
}
```

#### `lodash`

- **Vulnerabilities**:
  - [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) — Code Injection via `_.template` imports key names in `lodash <= 4.17.23`. CVSS High.
  - [GHSA-f23m-r3pf-42rh](https://github.com/advisories/GHSA-f23m-r3pf-42rh) — Prototype Pollution via array path bypass in `_.unset` and `_.omit` in `lodash <= 4.17.23`. CVSS High.
- **Root cause**: `@nestjs/config` and `@nestjs/swagger` both depend on `lodash@4.17.23`. `npm audit fix --force` would downgrade `@nestjs/config` to `1.1.5`, which is a breaking change.
- **Override**: `"lodash": "^4.18.1"` — forces the patched release (4.18.0+ fixes both advisories) across the entire tree.

**When it can be removed**: When `@nestjs/config` and `@nestjs/swagger` update their own `lodash` dependency to `>= 4.17.24` natively, or stop depending on lodash. Verify by removing the override and running `npm audit --omit=dev --audit-level=high`. Check with:

```sh
npm view @nestjs/config@latest dependencies.lodash
npm view @nestjs/swagger@latest dependencies.lodash
```

#### `ajv` overrides

- **Vulnerability**: [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) — ReDoS in `ajv < 8.18.0` when using the `$data` option.
- **Solution**: We pin the global `ajv` to `^8.18.0`.
- **Tooling Compatibility**: ESLint (v10.x) strictly requires `ajv@6` and uses legacy import paths (`ajv/lib/refs/json-schema-draft-04.json`) that break when it resolves to `ajv@8`. Keep the nested override so ESLint always resolves `ajv@^6.14.0`.

**When it can be removed**: When ESLint no longer depends on `ajv@6` internals and lint passes without the nested override.

#### `form-data`

- **Vulnerabilities**: Multiple advisories in `form-data < 4.0.6` (including GHSA-fjxv-7rqg-78g4 and related follow-up advisories).
- **Root cause**: Third-party chains in HTTP client tooling can resolve older `form-data` versions.
- **Override**: `"form-data": "^4.0.6"` — forces patched release across the tree.

**When it can be removed**: When all upstream direct consumers have moved to `>= 4.0.6`.

#### `js-yaml`

- **Vulnerability**: [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68) — quadratic-complexity DoS in `js-yaml <= 4.1.1`.
- **Root cause**: Security and test/reporting toolchains can resolve vulnerable nested `js-yaml` versions.
- **Override**: `"js-yaml": "4.2.0"` — enforces patched release globally.

**When it can be removed**: When all upstream ranges naturally resolve to `>= 4.2.0` and audits remain clean.

#### `mailparser` + nested `nodemailer`

- **Vulnerability family**: SMTP command/header injection issues in older `nodemailer` lines (for example GHSA-c7w3-x93f-qmm8 and GHSA-p6gq-j5cr-w38f).
- **Root cause**: `mailparser` and related preview chains can install nested `nodemailer` copies behind the secure top-level version.
- **Override**: `"mailparser": { ".": "^3.9.10", "nodemailer": "^9.0.1" }` — forces the patched parent and nested transport dependency.

**When it can be removed**: When upstream chains no longer install vulnerable nested `nodemailer` versions. Check with:

```sh
npm view mailparser@latest dependencies.nodemailer
```

#### `picomatch`

- **Vulnerability**: ReDoS and incorrect glob matching in `picomatch < 2.3.2` (v2 branch) and `picomatch < 4.0.4` (v4 branch).
- **Root cause**: Multiple packages install their own nested picomatch at vulnerable versions:
  - `anymatch` and `micromatch` install `picomatch@2.3.1` (nested, v2 branch).
  - `jest-haste-map` and related Jest internals install `picomatch@4.0.3` (nested, v4 branch).
  - The root-level `picomatch` was at `4.0.2`.
- **Solution**: Three override entries are used:
  - `"anymatch": { "picomatch": "^2.3.2" }` — ensures `anymatch` receives the patched v2 release rather than being forced to the incompatible v4 API.
  - `"micromatch": { "picomatch": "^2.3.2" }` — same reason as `anymatch`.

**When it can be removed**: When `anymatch` and `micromatch` update their own `picomatch` dependency ranges to `>= 2.3.2`, and when `jest-haste-map` (and related Jest packages) update their ranges to `>= 4.0.4`. Verify with:

```sh
npm view anymatch@latest dependencies.picomatch
npm view micromatch@latest dependencies.picomatch
```

#### Recently Removed Overrides

Overrides removed on **2026-04-05** as part of the TypeScript 6 upgrade review — all were found to be redundant because the dependency tree now resolves naturally to safe versions:

| Override | Previously forced | Reason for removal |
|---|---|---|
| `glob` | `^13.0.0` | All consumers (jest, rimraf, typeorm, @nestjs/cli, ts-jest) resolve naturally to `13.x` |
| `test-exclude` | `^8.0.0` | Resolves naturally to `8.0.0` via `babel-plugin-istanbul` |
| `brace-expansion` | `^5.0.5` | Resolves naturally to `5.0.5` via `minimatch` across the tree; `npm audit` clean without it |
| `fast-xml-parser` | `^5.5.6` | `@aws-sdk/xml-builder` now resolves naturally to `5.5.9` |
| `mjml` | `^5.0.0-beta.1` | `@nestjs-modules/mailer` now pulls `mjml@5.0.0-beta.2` directly |
| `serialize-javascript` | `^7.0.5` | No longer installed anywhere in the dependency tree (`terser-webpack-plugin` no longer requires it) |

Overrides removed on **2026-05-30** and **2026-06-24** during dependency tree review:

| Override | Previously forced | Reason for removal |
|---|---|---|
| `uuid` | `^11.1.1` | Removed as a global override once dependency updates and postinstall patch coverage made the global pin unnecessary |
| `file-type` | `^21.3.3` | No longer required after upstream package updates and lockfile refresh; audit stays clean without it |
| `path-to-regexp` | `^8.3.1` | No longer required after upstream dependency updates; audit stays clean without it |
| `preview-email.uuid` | `^11.1.1` | Removed from overrides; nested copy remains covered by postinstall patch until upstream chain resolves natively |

#### `mjml-core` — no override available (known vulnerability, no upstream fix)

- **Vulnerability**: [SNYK-JS-MJMLCORE-14417285](https://security.snyk.io/vuln/SNYK-JS-MJMLCORE-14417285) / CVE-2025-67898 — Directory Traversal via the `ignoreIncludes` parameter in `mjml-core`. CVSS Medium. **Fixed in: Not Fixed** (as of 2026-04-04).
- **Root cause**: `@nestjs-modules/mailer` depends on `mjml`, which pulls in `mjml-core@5.0.0-beta.2`. No patched release exists in any branch.
- **Risk assessment**: Exploitation requires an attacker to supply crafted input to the `ignoreIncludes` parameter. This project only processes internally authored email templates; no user-controlled content is passed to mjml. Practical exploitation risk is **low**.
- **No override action**: A version override cannot help because there is no patched release. `npm audit` does not flag this advisory (it is Snyk-specific).

**When it can be remediated**: When a patched `mjml-core` release is published. Monitor [CVE-2025-67898](https://www.cve.org/CVERecord?id=CVE-2025-67898) and the [mjml changelog](https://github.com/mjmlio/mjml/blob/master/CHANGELOG.md) for a fix. Verify with:

```sh
npm view mjml-core@latest version
```

---

### Postinstall Patch (`scripts/patch-nested-packages.js`)

This script runs automatically after every `npm install` and `npm ci` via the `postinstall` hook.

**Why it exists**: npm 11.x has a bug where nested overrides (e.g. `"A": { "B": "^x.y.z" }`) are not applied when package `B` is also a direct top-level dependency. In these cases, npm installs the older nested version even though the override is declared. The script works around this by:

1. Detecting any nested package install that is behind the required version.
2. Replacing it in `node_modules` by copying the safe top-level version.
3. Updating `package-lock.json` so that `npm audit` reports the correct version.

**Adding a new patch entry**: Edit the `patches` array in `scripts/patch-nested-packages.js`:

```js
const patches = [
  // [ 'path/within/node_modules/to/nested/package', 'top-level-package-name' ]
  ['@nestjs/platform-express/node_modules/multer', 'multer'],
  ['mailparser/node_modules/nodemailer', 'nodemailer'],
  ['preview-email/node_modules/nodemailer', 'nodemailer'],
  ['preview-email/node_modules/uuid', 'uuid'],
];
```

**Removing a patch entry**: When the upstream package fixes its own dependency so the nested install no longer appears (or already uses the safe version), remove the corresponding entry from the `patches` array. Also remove the matching nested override from `package.json` if it is no longer needed.

#### `nodemailer` (nested under `mailparser` / `preview-email`)

- **Vulnerability**: [GHSA-c7w3-x93f-qmm8](https://github.com/advisories/GHSA-c7w3-x93f-qmm8) — SMTP command injection via unsanitised `envelope.size` parameter in `nodemailer < 8.0.4`. Severity: Low.
- **Root cause**: `mailparser` and `preview-email` can install nested `nodemailer` versions behind the secure top-level dependency. npm 11.x nested-override behavior can leave those copies in place.
- **Patch**: `['mailparser/node_modules/nodemailer', 'nodemailer']` and `['preview-email/node_modules/nodemailer', 'nodemailer']` copy the safe top-level `nodemailer` into nested installs after every `npm install` / `npm ci`.

**When it can be removed**: When `mailparser` and `preview-email` both resolve patched `nodemailer` natively and nested vulnerable copies are no longer installed. Verify with:

```sh
npm view mailparser@latest dependencies.nodemailer
npm view preview-email@latest dependencies.nodemailer
```

#### `uuid` (nested under `preview-email`)

- **Vulnerability**: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — Missing buffer bounds check in UUID v3/v5/v6 when `buf` is provided (`uuid < 11.1.1`). Severity: Moderate.
- **Root cause**: `preview-email@3.1.3` pins `uuid@^9.0.1`. Because `uuid` is also a top-level dependency, npm 11.x can leave the nested vulnerable copy in place even when a nested override is declared.
- **Patch**: `['preview-email/node_modules/uuid', 'uuid']` copies the safe top-level `uuid` into nested preview-email installs after every `npm install` / `npm ci`.

**When it can be removed**: When `preview-email` updates its own `uuid` dependency to `>= 11.1.1`. Verify with:

```sh
npm view preview-email@latest dependencies.uuid
```

## CORS Configuration

### Purpose

CORS (Cross-Origin Resource Sharing) controls which domains can make requests to the backend API from browsers.

### Configuration Location

CORS is configured in `src/main.ts`.

### Development CORS Settings

**Allowed Origins:**

```typescript
origin: [
  'http://localhost:4200', // Local frontend dev server
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
2. Request blocked by browser preflight/CORS negotiation
3. Preflight OPTIONS request failing

**Solutions:**

1. Add frontend origin to CORS configuration
2. Ensure the request includes the required headers (for example `Authorization`) and uses an allowed method/header set
3. Check backend logs for OPTIONS request failures

Note: The backend currently uses bearer tokens (the `Authorization` header). Cookie-based auth is not currently used; only enable `withCredentials` client-side if you intentionally introduce cookie-based authentication.

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

**Rationale:**

- Prevents excessive storage usage
- Limits impact of denial-of-service attacks
- Ensures reasonable upload times for users
- Aligned with Cloudflare Images size limits

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

**Policy:**

- Minimum 8 characters.
- Must include uppercase, lowercase, numbers, and symbols.
- Enforced via `class-validator` `IsStrongPassword` on registration and reset DTOs.

## JWT Security

### JWT Secret

JWT signing secrets are loaded from AWS Secrets Manager via `SecretsService`.

**Requirements:**

- Long random string (at least 256 bits)
- Rotate on suspected compromise
- Never commit to version control

### JWT Secret Rotation

**Current Policy:**

> **Policy:** JWT secrets are rotated every 180 days or immediately upon suspected compromise. Rotation is owned by the Lead Developer.

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
- Rate limit state is stored in **Redis** to ensure scalability and prevent memory leaks.
- Each rate limiting category (Read, Write, Auth, Expensive) uses a dedicated RedisStore instance with its own key prefix (e.g., `rl:read:`, `rl:auth:`).

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
- **Automated Bots**: Known CI runners (e.g., GitHub Actions) can bypass certain WAF and rate limiting blocks by providing a custom `User-Agent: Mozilla/5.0`. This is used for automated health and version checks.

> TODO: Document any additional rate-limit bypass rules (trusted IPs, admin tooling) and where they are configured (Cloudflare vs backend).

## Proxy, client IP, and IPv6

- The backend runs behind Cloudflare; `req.ip` will reflect Cloudflare unless proxy trust is configured
- The backend sets Express `trust proxy` to `TRUST_PROXY_HOPS` when not running in `local`
- Client IP is derived in this order: `CF-Connecting-IP`, first `X-Forwarded-For`, then `req.ip`
- IPv6-mapped IPv4 values like `::ffff:192.0.2.1` are normalised to IPv4

## Compliance & OpenSSF Best Practices

The project maintains an **OpenSSF Best Practices Badge**. This documentation serves as the base for our **Assurance Case** (Silver/Gold requirement).

### Secrets Management Policy (Silver/Gold)

1. **Storage**: All production secrets (database credentials, API keys, signing secrets) MUST be stored in **AWS Secrets Manager**.
2. **Access Control**: Runtime access is provided via IAM roles with least-privilege policies. Only the `SecretsService` should interface with the secret store.
3. **No Hardcoding**: Secrets or credentials MUST NEVER be committed to version control. This is enforced via automated CI checks and `.env.example` templates.
4. **Rotation**:
   - **JWT Secrets**: Rotated every 180 days.
   - **API Keys**: Rotated annually or following a leaver event with access.
   - **HMAC Service Keys**: Rotated only if compromised (see note on data migration in `Email address hashing`).
5. **Incidents**: Upon suspected compromise, secrets are revoked in the provider (e.g., Cloudflare, AWS) and updated in Secrets Manager immediately.

### Cryptography (Silver/Gold Standard)

The project adheres to the following cryptographic standards:

- **Algorithms**: Only industry-standard, non-deprecated algorithms are used.
  - **Password Hashing**: `Bcrypt` (with adaptive cost).
  - **PII Hashing**: `HMAC-SHA256` (SHA-256 remains secure for the foreseeable future).
  - **Digital Signatures**: `RS256` or `HS256` for JWTs.
- **Implementations**: No custom cryptography. We use the Node.js native `crypto` module, `bcrypt`, and `jsonwebtoken`.
- **Key Lengths**:
  - HMAC keys must be at least 32-64 random bytes.
  - JWT keys must be at least 256-bit entropy.
- **Entropy**: All random values (tokens, secrets) are generated using cryptographically secure PRNGs (`crypto.randomBytes`).

### Coding Standards & Quality

- **Static Analysis**: Automated linting (`eslint`) and type-checking (`tsc`) run on every PR.
- **Dependency Scanning**: `npm audit` is a blocking step in CI (`npm run verify`).
- **DCO (Developer Certificate of Origin)**: All commits must be signed-off (`Signed-off-by`) to ensure clear chain of ownership and licensing.

## Proxy, client IP, and IPv6

### Audit tables

| Table                  | PII stored                                  | Retention                                                                                                                                                              |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_audit`               | `ipAddress` (nullable), `userId`            | `ipAddress` nulled after `AUDIT_IP_NUKE_THRESHOLD_DAYS`; records deleted after `AUDIT_DATA_NUKE_THRESHOLD_DAYS`                                                        |
| `_audit_login_attempt` | `email` (nullable), `ipAddress` (nullable)  | Same as above                                                                                                                                                          |
| `_audit_ses_event`     | `emailHashed` (HMAC-SHA256 — not plaintext) | Non-suppressing records deleted after `SES_AUDIT_RETENTION_DAYS` (180 days); suppression records deleted after `SES_SUPPRESSION_RETENTION_DAYS` (2557 days / ~7 years) |
| `contact_request`      | `emailMasked` (nullable)                    | Email nulled after `CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS`; records deleted after `CONTACT_REQUEST_RECORD_RETENTION_DAYS`                                          |

- A daily cron job (UTC, 03:26 and 00:00) runs all retention cleanup jobs in sequence.
- A failed individual job is logged and swallowed so the others continue.

## Email Delivery Security

### SES Webhook (`POST /webhooks/ses`)

The endpoint receives SNS HTTP notifications containing SES bounce, complaint, and delivery events.

**TopicArn validation:**

Every incoming notification is validated against `AWS_SNS_TOPIC_ARN`. Requests with a non-matching `TopicArn` are rejected with `403 Forbidden`. This prevents spoofed SNS notifications from arbitrary topics being processed as legitimate SES events.

**Idempotency:**

SNS guarantees at-least-once delivery. The `snsMessageId` field is stored with a `UNIQUE` constraint. Duplicate deliveries of the same message are silently skipped before any write is attempted.

### Email address hashing

Email addresses received via SES bounce/complaint/delivery events are **never stored in plaintext**. Before any database write the address is passed through:

```
HMAC-SHA256(key = SES_EMAIL_HMAC_SECRET, data = email.toLowerCase())
```

The resulting 64-character hex digest (`emailHashed`) is stored instead. This means:

- The database contains no reversible PII, even if it is exfiltrated.
- Suppression lookups are O(1) index scans (deterministic output per address + key pair).
- Rainbow tables cannot be used without the secret key.

**Key rotation warning:** Changing `SES_EMAIL_HMAC_SECRET` invalidates all existing suppression records because the stored hashes will no longer match re-hashed lookups. If rotation is required, plan a migration to rehash existing rows with the new key before cutting over.

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

**Current Status**:
Implemented in `src/main.ts` using a per-request `nonce` provided by `NonceMiddleware`.

- **Policy**: `default-src 'none'; frame-ancestors 'none'; style-src 'self'; img-src 'self'; script-src 'self' 'nonce-{{nonce}}';`
- **Swagger Exception**: A relaxed policy is applied to the `/swagger` endpoint in development to allow styles/fonts required for documentation.

### HSTS (Strict-Transport-Security)

- **Status**: Enabled via Helmet.
- **Policy**: Enforces HTTPS for all sessions. Cloudflare also enforces a "Always Use HTTPS" rule at the edge.

### Software Supply Chain (OpenSSF Gold)

- **Reproducible Builds**: The project uses `package-lock.json` to ensure deterministic builds. CI builds use `npm ci` to guarantee that the exact same dependency tree is used in every environment.
- **Two-Factor Authentication (2FA)**: 2FA is REQUIRED for all developers with merge access to the GitHub repository and access to the AWS Console.
- **Code Review**: All modifications must be submitted via Pull Requests and undergo review by at least one other contributor before merging.

## Security Considerations

### Attack Vectors Addressed

- **SQL Injection**: TypeORM parameterised queries
- **XSS**: Input sanitisation, CSP headers, no SVG uploads
- **CSRF**: Token-based if using cookies (check implementation)
- **Brute Force**: Rate limiting on login endpoints
- **DDoS**: Cloudflare edge protection + backend rate limiting
- **File Upload Attacks**: MIME type validation, size limits, SVG blocking
- **Spoofed SNS Notifications**: `TopicArn` validation on `POST /webhooks/ses`
- **Email PII Exposure**: HMAC-SHA256 hashing of all email addresses in `_audit_ses_event`
- **Credential Storage**: Use of AWS Secrets Manager avoids environment variable leakage on logs or child processes (OpenSSF Silver requirement).

### Known Security Considerations

**Document any known security limitations or areas for improvement:**

- Token refresh strategy (if not implemented, plan to implement)
- Two-factor authentication (if not implemented, consider for future)
- Audit logging (track sensitive operations for security review)
- Dependency vulnerability scanning (npm audit, Dependabot)
