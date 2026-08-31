# Security Documentation

This document outlines the security architecture and procedures for the `sto-info-backend`. The project aims to meet **OpenSSF Best Practices Silver** level (and Gold where practical) to ensure high standards of software supply chain security and application hardening.

### Dependency Overrides

This repository uses `npm overrides` in `package.json` to address security issues that originate in transitive dependencies where upgrading a top-level package is not yet possible or would require a breaking change.

**General removal checklist** (apply to any override before removing it):

1. Remove the entry from the `overrides` block in `package.json`.
2. Run `npm install --legacy-peer-deps` to regenerate `package-lock.json`. CI installs with `npm ci --ignore-scripts --legacy-peer-deps`, so the lockfile must be produced with the same peer-resolution mode.
3. Run `npm audit --omit=dev --audit-level=high` — this is the same gate used by `npm run verify` in CI.
4. Run `npm run test:cov` to confirm coverage tooling is unaffected.
5. If either check fails, restore the override and track the upstream fix instead.

Overrides reduce exposure to known vulnerabilities quickly, but they change the dependency tree independently of what upstream packages tested against. Keep them minimal and prefer removing them as soon as upstream dependencies have caught up.

Current overrides in `package.json`:

```json
"overrides": {
  "mailparser": {
    ".": "^3.9.10",
    "nodemailer": "^9.0.1"
  },
  "nanoid": "3.3.18",
  "qs": "^6.15.2",
  "js-yaml": ">=5.2.2",
  "typeorm": {
    "ioredis": "^6.0.0"
  }
}
```

#### `nanoid`

- **Vulnerability**: [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) — custom generators can loop indefinitely when their size is zero. Affected versions are `< 3.3.18`. Severity: High.
- **Root cause**: `postcss@8.5.26`, used by `mjml-core` through `@nestjs-modules/mailer`, accepts `nanoid@^3.3.16` and the lockfile previously resolved it to vulnerable `3.3.17`.
- **Override**: `"nanoid": "3.3.18"` — pins the transitive dependency to the first patched version.

**When it can be removed**: When the dependency tree resolves `nanoid >= 3.3.18` without the override. Check with:

```sh
npm ls nanoid
```

#### `js-yaml`

- **Vulnerability**: [GHSA-pm4m-ph32-ghv5](https://github.com/advisories/GHSA-pm4m-ph32-ghv5) — exponential parsing time in nested flow collections allows a small YAML document to block the Node.js event loop. Affected versions are `5.0.0 - 5.2.1`; patched in `5.2.2`. Severity: High.
- **Root cause**: `@nestjs/swagger@11.4.7` still exact-pins `js-yaml@5.3.0` (itself patched). Without a global override, other tooling (`cosmiconfig`, `@istanbuljs/load-nyc-config`) can also install nested `js-yaml` 3.x / 4.x copies alongside that pin.
- **Override**: `"js-yaml": ">=5.2.2"` — forces the whole tree onto the patched 5.x line (currently `5.4.1`).

**When it can be removed**: When `@nestjs/swagger` requests `js-yaml >= 5.2.2` as a range (not an exact pin) and the remaining dependency tree resolves no affected copies. Check with:

```sh
npm view @nestjs/swagger@latest dependencies.js-yaml
npm ls js-yaml
```

#### `mailparser` + nested `nodemailer`

- **Vulnerability family**: SMTP command/header injection and access-control-bypass issues in older `nodemailer` lines (for example GHSA-c7w3-x93f-qmm8 and GHSA-p6gq-j5cr-w38f), plus [GHSA-22p9-wv53-3rq4](https://github.com/advisories/GHSA-22p9-wv53-3rq4) — quadratic complexity in `linkify-it <= 5.0.0`, a `mailparser` dependency.
- **Root cause**: `preview-email@3.4.0` (pulled in by `@nestjs-modules/mailer`) still exact-pins `mailparser@3.9.17`. That release is itself patched, but an exact pin lets a later `npm update` drop back onto an older exact pin if upstream regresses, and npm will not hoist a newer `3.9.18` without an override.
- **Override**: `"mailparser": { ".": "^3.9.10", "nodemailer": "^9.0.1" }` — keeps the patched parent on `^3.9.10` (currently `3.9.18`), which resolves to `nodemailer@9.1.0` and `linkify-it@5.0.2`.

**When it can be removed**: When `preview-email` raises its own `mailparser` pin to a range (`>= 3.9.9` or `^3.9.10`) and the transitive dependency chain resolves fully patched. Check with:

```sh
npm view preview-email@latest dependencies.mailparser
npm view mailparser@latest dependencies.nodemailer
```

#### `qs`

- **Vulnerability**: [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26) — remotely triggerable DoS in `qs 6.11.1 - 6.15.1` (`qs.stringify` crashes on null/undefined entries in comma-format arrays).
- **Root cause**: `typed-rest-client@2.3.1` (via `@stryker-mutator/core`) pins `qs@6.15.1` exactly.
- **Override**: `"qs": "^6.15.2"` — global pin; the whole tree dedupes to a single patched `qs` (currently `6.16.0`). A nested `"typed-rest-client": { "qs": ... }` form was tried first but npm did not reify it reliably, so the global form is used.

**When it can be removed**: When `typed-rest-client` raises its `qs` pin to `>= 6.15.2` (or Stryker moves to `typed-rest-client@3`). Check with:

```sh
npm view typed-rest-client@latest dependencies.qs
```

#### `html-to-text`

- **Vulnerability**: [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) — `deepmerge-ts` can stack-exhaust when recursively merging object graphs. Affected `deepmerge-ts` versions are patched from `8.0.0`.
- **Current project state (2026-08-31)**: the app and `mailparser@3.9.18` both resolve `html-to-text@10.0.1`, which depends on `deepmerge-ts@^8.0.1` (currently `8.0.2`). No override is required.
- **Previously**: the app pinned `html-to-text@^9.0.5` and left a nested `10.0.0` copy under `preview-email`. That nested copy is gone after the mailparser / preview-email refresh.

**When it can be re-checked**: If `html-to-text` or `mailparser` regresses onto `deepmerge-ts < 8`. Check with:

```sh
npm ls deepmerge-ts html-to-text
```

#### `typeorm` + `ioredis`

- **Issue**: `typeorm@1.1.0` declares an optional peer on `ioredis@^5.0.4`, which npm reports as a peer conflict when the app installs `ioredis@^6` directly.
- **Why this is safe here**: the project does not rely on TypeORM's optional Redis cache integration for its main PostgreSQL work; the active runtime Redis usage is the direct `express-rate-limit` stack in [src/main.ts](src/main.ts).
- **Override**: `"typeorm": { "ioredis": "^6.0.0" }` — keeps npm's resolution valid while respecting the fact that this peer is optional and not required for the app's database path.

**When it can be removed**: When upstream `typeorm` publishes a compatible optional peer for `ioredis@^6` or the project no longer uses the direct `ioredis` client for rate limiting.

#### Babel 7 (Jest) and Babel 8 (Stryker)

- **Issue**: `@jest/transform` and related Jest packages depend on `@babel/core@^7.27.4`. `@stryker-mutator/core@10` instruments through Babel 8. `ts-jest@29` still declares an optional Babel 7 peer. CI installs with `npm ci --legacy-peer-deps`, which keeps both lines: Babel 7 at the top of the tree for Jest, Babel 8 nested under `@stryker-mutator/instrumenter`.
- **No override**: forcing `ts-jest` onto Babel 8 drops `@babel/core@7.29.7` from the lockfile. `npm ci --legacy-peer-deps` then fails with "Missing: @babel/core@7.29.7 from lock file".
- **How to refresh the lockfile**: `npm install --legacy-peer-deps` (never a plain `npm install` / `npm update`). Confirm with `npm ci --ignore-scripts --legacy-peer-deps` and `npm ls @babel/core`.

#### NestJS 12 — deferred (2026-08-31)

Dependabot opened isolated majors for `@nestjs/common`, `@nestjs/core`, `@nestjs/config`, `@nestjs/swagger`, `@nestjs/typeorm`, `@nestjs/passport`, `@nestjs/cli`, and `@nestjs/schematics` onto the 12.x line. Those packages are now native ESM. They are **not** included in this refresh, for all of the following:

1. **Ecosystem packages have no Nest 12 release yet.** `nestjs-cls@6.2.2` declares `@nestjs/common` / `@nestjs/core` `>= 10 < 12`. `@nestjs/terminus@11.1.1` and `@nestjs/throttler@6.5.0` still peer onto Nest 10/11 only. The app uses all three (`ClsModule` in `src/app.module.ts`, `TerminusModule` in `src/health/health.module.ts`, and `@nestjs/throttler` on the tree).
2. **Isolated ESM majors fail this Jest setup unless Node VM modules are enabled.** Dependabot's Nest 12 PRs failed `Security: Fuzz` with `Must use import to load ES Module`. Jest 30 can `require()` ESM on Node 24.9+, but that path needs `vm.SourceTextModule` (`--experimental-vm-modules`). Test scripts now set that flag so `@nestjs/jwt@12` loads; a whole-framework ESM cutover is still a separate Jest/Vitest piece of work, not a lockfile bump.
3. **CLI 12 is the Nest 12 toolchain.** `@nestjs/cli@12` stops bundling webpack, defaults new apps to ESM / Vitest / oxlint / Rspack, and ships `nest upgrade`. It belongs with the Nest 12 cutover, not a Nest 11 runtime.

Take Nest 12 as its own change once `nestjs-cls`, `@nestjs/terminus`, and `@nestjs/throttler` publish Nest 12-compatible releases, then upgrade every `@nestjs/*` package together (the CLI's `nest upgrade` command is the intended path) and rework the Jest config for ESM.

`@nestjs/jwt@12.0.1` is already on the Nest 11 tree (its peer range includes Nest 8–12). It is a native ESM package with no `require` export condition. Jest 30's `require(esm)` support is gated on `vm.SourceTextModule.prototype.hasAsyncGraph`, which on Node 24.15 still needs `--experimental-vm-modules`. The Jest npm scripts and Stryker `testRunnerNodeArgs` therefore set that flag so auth specs can load `@nestjs/jwt`. Runtime (`node dist/src/main`) does not need the flag: Node 24 can `require()` the ESM build via the `default` export condition.

**When it can be retried**:

```sh
npm view nestjs-cls@latest peerDependencies
npm view @nestjs/terminus@latest peerDependencies
npm view @nestjs/throttler@latest peerDependencies
```

#### TypeScript compatibility gate

- **Issue**: `@nestjs/cli` in this project requires the TypeScript compiler API, which is not exposed in `typescript@7` at the time of this upgrade. The CLI fails with: `The installed TypeScript version (7.0.2) does not expose the programmatic compiler API that the Nest CLI requires.`
- **Constraint**: the project remains pinned to `typescript@^6.0.3` until the Nest CLI ecosystem adds support for the TypeScript 7 compiler API.
- **Why this is intentional**: the backend is currently on a stable Nest 11 toolchain, and the compatibility boundary is lower than the newest TypeScript release.

#### Recently Removed Overrides

The `preview-email/node_modules/uuid` postinstall patch was removed on **2026-08-31**: `preview-email@3.4.0` no longer installs a nested `uuid`, and the top-level `uuid@14.0.2` is the only copy.

Overrides removed on **2026-08-15** during dependency and audit maintenance:

| Override   | Previously forced | Reason for removal                                                                                         |
| ---------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `ioredis`  | `^5.11.1`         | Direct dependencies already constrain the tree to `5.11.1`; regenerating the lockfile leaves audit clean. |

Overrides removed on **2026-08-05** during dependency and audit maintenance:

| Override          | Previously forced | Reason for removal                                                                                  |
| ----------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `brace-expansion` | `^5.0.8`          | Dependency tree now resolves naturally to `5.0.9` or newer; `npm audit` remains clean without it. |

Overrides removed on **2026-07-21** during the dependency security review — all verified redundant by the removal checklist above (audit clean, lint, build, and full test suite pass without them):

| Override               | Previously forced | Reason for removal                                                                                                                                                                                            |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lodash`               | `^4.18.1`         | Whole tree now resolves naturally to `4.18.1`                                                                                                                                                                 |
| `ajv` (global)         | `^8.18.0`         | Consumers resolve naturally to `8.18.0`; no vulnerable copies installed                                                                                                                                       |
| `eslint.ajv` (nested)  | `^6.14.0`         | `eslint@10.7.0` resolves `ajv@6.14.0` natively and `npm run lint` passes without the override                                                                                                                 |
| `form-data`            | `^4.0.6`          | Whole tree resolves naturally to `4.0.6`                                                                                                                                                                      |
| `js-yaml`              | `4.2.0`           | This older constraint was removed after consumers resolved the then-patched `4.3.0` and `5.2.1` lines naturally. A new `>=5.2.2` override was added on 2026-07-25 for the later GHSA-pm4m-ph32-ghv5 advisory. |
| `anymatch.picomatch`   | `^2.3.2`          | `anymatch` resolves `picomatch@2.3.2` natively                                                                                                                                                                |
| `micromatch.picomatch` | `^2.3.2`          | `micromatch` resolves `picomatch@2.3.2` natively                                                                                                                                                              |

Overrides removed on **2026-04-05** as part of the TypeScript 6 upgrade review — all were found to be redundant because the dependency tree now resolves naturally to safe versions:

| Override               | Previously forced | Reason for removal                                                                                  |
| ---------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `glob`                 | `^13.0.0`         | All consumers (jest, rimraf, typeorm, @nestjs/cli, ts-jest) resolve naturally to `13.x`             |
| `test-exclude`         | `^8.0.0`          | Resolves naturally to `8.0.0` via `babel-plugin-istanbul`                                           |
| `brace-expansion`      | `^5.0.5`          | Resolves naturally to `5.0.5` via `minimatch` across the tree; `npm audit` clean without it         |
| `fast-xml-parser`      | `^5.5.6`          | `@aws-sdk/xml-builder` now resolves naturally to `5.5.9`                                            |
| `mjml`                 | `^5.0.0-beta.1`   | `@nestjs-modules/mailer` now pulls `mjml@5.0.0-beta.2` directly                                     |
| `serialize-javascript` | `^7.0.5`          | No longer installed anywhere in the dependency tree (`terser-webpack-plugin` no longer requires it) |

Overrides removed on **2026-05-30** and **2026-06-24** during dependency tree review:

| Override             | Previously forced | Reason for removal                                                                                                  |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `uuid`               | `^11.1.1`         | Removed as a global override once dependency updates and postinstall patch coverage made the global pin unnecessary |
| `file-type`          | `^21.3.3`         | No longer required after upstream package updates and lockfile refresh; audit stays clean without it                |
| `path-to-regexp`     | `^8.3.1`          | No longer required after upstream dependency updates; audit stays clean without it                                  |
| `preview-email.uuid` | `^11.1.1`         | Removed from overrides; nested copy remains covered by postinstall patch until upstream chain resolves natively     |

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
];
```

**Removing a patch entry**: When the upstream package fixes its own dependency so the nested install no longer appears (or already uses the safe version), remove the corresponding entry from the `patches` array. Also remove the matching nested override from `package.json` if it is no longer needed.

#### `nodemailer` (nested under `mailparser` / `preview-email`)

- **Vulnerability**: [GHSA-c7w3-x93f-qmm8](https://github.com/advisories/GHSA-c7w3-x93f-qmm8) — SMTP command injection via unsanitised `envelope.size` parameter in `nodemailer < 8.0.4`. Severity: Low.
- **Root cause**: `mailparser` and `preview-email` can install nested `nodemailer` versions behind the secure top-level dependency. npm 11.x nested-override behavior can leave those copies in place.
- **Patch**: `['mailparser/node_modules/nodemailer', 'nodemailer']` and `['preview-email/node_modules/nodemailer', 'nodemailer']` copy the safe top-level `nodemailer` into nested installs after every `npm install` / `npm ci`.

**Status (2026-08-31)**: With the `mailparser` override resolving `3.9.18` (which depends on patched `nodemailer` natively) and `preview-email@3.4.0` requesting `nodemailer@^9.0.6`, no nested `nodemailer` copies are currently installed — both entries are no-ops kept as a safety net against future re-resolution.

**When it can be removed**: When `mailparser` and `preview-email` both resolve patched `nodemailer` natively and nested vulnerable copies are no longer installed. Verify with:

```sh
npm view mailparser@latest dependencies.nodemailer
npm view preview-email@latest dependencies.nodemailer
```

#### `uuid` (nested under `preview-email`) — removed 2026-08-31

- **Vulnerability**: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — Missing buffer bounds check in UUID v3/v5/v6 when `buf` is provided (`uuid < 11.1.1`). Severity: Moderate.
- **Previous patch**: `['preview-email/node_modules/uuid', 'uuid']` copied the safe top-level `uuid` into nested preview-email installs.
- **Removed**: `preview-email@3.4.0` no longer installs a nested `uuid`. The tree has a single `uuid@14.0.2`. Restore the patch if `npm ls uuid` shows a nested copy below `11.1.1` again.

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
