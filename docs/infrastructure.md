# Infrastructure and Hosting Documentation

## Render.com

### Overview

Both frontend and backend are hosted on Render.com as separate web services.

- **Backend**: NestJS application (this repository)
- **Frontend**: Client application (separate repository)
- **Database**: Render.com managed PostgreSQL instance

### Backend Web Service Configuration

**Service Type:** Web Service

**Build Command:**

```bash
npm install && npm run build
```

**Start Command:**

```bash
npm run start:prod
```

**Environment:** Node

**Deployment:**

- Auto-deploy from `production` branch (or configured branch)
- Manual deploys also available via Render dashboard

> TODO: Confirm the exact Render service name(s), repository/branch used for auto-deploy, and whether any preview/staging environments exist.

### Environment Variables in Render

**Critical Environment Variables:**

All variables from `config/environments/.env.example` must be configured in Render's environment settings.

**Key Variables:**

- `NODE_ENV=prod`
- `LOG_LEVEL`
- `APP_PORT`
- `APP_FRONTEND_URL`: Production frontend URL (used for CORS and links in emails)
- `APP_TITLE`
- `AWS_REGION`
- `AWS_SECRET_NAME`: Name/ARN of the AWS Secrets Manager secret (contains `jwtSecret`, `dbPassword`, and third-party API keys)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (required if your Render service uses static AWS credentials)
- `DB_TYPE=postgres`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SCHEMA`, `DB_USERNAME`, `DB_SSL_REJECT_UNAUTHORIZED`
- `TYPEORM_SYNCHRONIZE=false`
- `TYPEORM_LOGGING=false`
- `TYPEORM_ENTITIES`, `TYPEORM_MIGRATIONS`
- `CLOUDFLARE_R2_ENDPOINT`
- `CLOUDFLARE_R2_BUCKET_NAME`
- `CLOUDFLARE_CDN_ROOT_URL`
- `CLOUDFLARE_IMAGES_HASH`
- `MAX_IMAGE_SIZE_IN_BYTES`
- `AUDIT_DATA_NUKE_THRESHOLD_DAYS`
- `AUDIT_IP_NUKE_THRESHOLD_DAYS`
- `TRUST_PROXY_HOPS=1` (optional, defaults to 1)

Optional (Storytime):

- `STORYTIME_PUBLIC_READ_ENABLED`, `STORYTIME_CREATION_ENABLED`, `STORYTIME_YOUTUBE_ENABLED`, `STORYTIME_SPOTLIGHT_ENABLED` (default `true` when unset)
- `STORYTIME_MAX_STORIES_PER_USER`, `STORYTIME_MAX_CHAPTERS_PER_STORY`, `STORYTIME_MAX_CHARACTERS_PER_STORY`, `STORYTIME_MAX_CONTENT_LENGTH`, `STORYTIME_UPLOAD_MAX_BYTES`

> The Storytime master switch, `STORYTIME_ENABLED`, is **not** a Render environment variable. It lives in the `app_setting` table so it can be thrown from the admin API without a redeployment, and is seeded disabled.

Optional (diagnostics):

- Periodic memory diagnostics: set `MEMORY_DIAGNOSTICS_ENABLED=true`, `MEMORY_DIAGNOSTICS_INTERVAL_MINUTES=10`, and ensure `LOG_LEVEL` includes `log`; deploy/restart to apply. Disable with `MEMORY_DIAGNOSTICS_ENABLED=false` and deploy/restart again. Restore the previous log level when finished. See the [enable/disable runbook](environment-variables.md#enable-in-render), including how to verify the logs.

- `STARTUP_DIAGNOSTICS=true` (temporarily) to emit additional startup memory/timing logs in Render. Useful when investigating intermittent RSS jumps on boot.

Optional (seed user):

- `DATASEED_USER_EMAIL`, `DATASEED_USER_USERNAME`, `DATASEED_USER_FIRSTNAME`, `DATASEED_USER_LASTNAME`, `DATASEED_USER_PASSWORD`

**Updating Environment Variables:**

1. Navigate to service in Render dashboard
2. Go to Environment tab
3. Add/update variables
4. Service will automatically redeploy when environment changes

### Database Service Configuration

- **Service Type:** PostgreSQL (Managed)
- **Version:** PostgreSQL 18
- **Plan:** Basic-256mb
- **Backups:** 7-day logical backup retention
- **Extensions:** No additional extensions enabled (e.g., `uuid-ossp`, `pg_trgm`).

> TODO: Verify the managed Postgres version/plan/backup retention/extensions from the Render dashboard (and update this section if they differ).

### Redis Service Configuration

- **Service Type:** Redis (Managed)
- **Version:** Redis 7.x
- **Plan:** Starter (256MB memory, 10 connections)
- **Persistence:** AOF (Append-Only File) enabled for data durability
- **Eviction Policy:** `noeviction` (fails writes when memory limit reached)

**Usage:**

Redis is used for:

1. **Rate Limiting State**: All rate limiting categories (Read, Write, Auth, Expensive) store their state in Redis with unique key prefixes (`rl:read:`, `rl:write:`, `rl:auth:`, `rl:expensive:`)
2. **Refresh Token Revocation**: Revoked refresh token tracking (future implementation)

**Connection String:**

- Render automatically provides `REDIS_URL` environment variable for managed Redis instances
- Format: `redis://red-xxxxx:port`
- Render-managed Redis instances are private and only accessible from services within the same Render account

**Key Patterns:**

- `rl:read:{ip}`: Read operation rate limit tracking
- `rl:write:{ip}`: Write operation rate limit tracking
- `rl:auth:{ip}`: Authentication endpoint rate limit tracking
- `rl:expensive:{ip}`: Expensive operation rate limit tracking

**IPv6 Handling:**

- Rate limiting keys use `/64` subnet for IPv6 addresses (common recommendation for IPv6 subnetting)
- IPv4 addresses are used as-is
- IPv6-mapped IPv4 addresses (e.g., `::ffff:192.0.2.1`) are normalized to IPv4 format (`192.0.2.1`)

**Local Development:**

For local development, install Redis locally:

- **Windows**: Use WSL2 with Redis or Redis for Windows
- **macOS**: `brew install redis` then `brew services start redis`
- **Linux**: Install via package manager (e.g., `apt install redis-server`)

Set `REDIS_URL=redis://localhost:6379` in your local `.env` file.

> TODO: Verify the exact Redis version/plan/persistence settings from the Render dashboard and update if they differ.

### Health Check Endpoints

**Backend Health Check:**

```
GET /health/ready
```

Alternative liveness check:

```
GET /health/live
```

**Render Configuration:**

- Health check path: `/health/ready`
- Expected status: 200 OK
- Used by Render to determine service health
- Unhealthy services may be restarted automatically

### Scaling Configuration

- **Instances:** One
- **Auto-Scaling:** Disabled

### Render Dashboard

**Accessing Logs:**

1. Log in to Render dashboard
2. Select the service (backend or database)
3. View "Logs" tab for real-time and historical logs

**Metrics:**

- CPU usage
- Memory usage
- Request count
- Response times

**Deployment History:**

- View past deployments
- Rollback to previous deployment if needed

## Cloudflare

### DNS Configuration

** Production Domains:**

- `startrekonline.info`: Frontend
- `api.startrekonline.info`: Backend API
- `cdn.startrekonline.info`: Asset delivery — **two products behind one hostname**, see below

**Development Domains:**

- `dev.startrekonline.info`: Development frontend
- `dev-api.startrekonline.info`: Development backend API
- `dev-cdn.startrekonline.info`: Development asset delivery

### How the CDN hostname is used — read this before touching images

`cdn.startrekonline.info` is **one Cloudflare custom domain fronting two different products**,
told apart by the path. This is the single most confusing thing about the image setup and it has
already caused one wrong conclusion, so it is written down here explicitly.

| Path | Product | What it serves |
| --- | --- | --- |
| `/cdn-cgi/imagedelivery/<hash>/<imageId>/<variant>` | **Cloudflare Images** | Every image the site uploads today |
| `/cdn-cgi/image/<options>/<key>` | **Cloudflare Image Resizing**, over an R2 object | Legacy Character portraits only |
| `/<key>` — anything else | **The delivery R2 bucket** | Legacy Character portraits only |

Both are live: the domain is bound to the delivery R2 bucket *and* fronts Cloudflare Images. The
quarantine bucket is not bound to it, which is checked by
`npm run probe:asset-delivery`.

So the presence of `CLOUDFLARE_CDN_ROOT_URL` in the code says nothing about **which** of the two
a given line of code is using — it is the Images custom domain far more often than it is an R2
route, and the two are told apart only by the path.

Two further things are easy to miss:

- **Every Cloudflare Images object is also reachable at `https://imagedelivery.net/<hash>/<id>/<variant>`**,
  a hostname this custom domain's cache purge does not touch. Withdrawing a published image must
  therefore be a *delete* of the image, not a cache purge.
- **The CDN hostname differs per environment** (`cdn.` and `dev-cdn.`), while the R2 buckets behind
  the estate are single buckets with the environment as a key prefix. Domain is per environment;
  bucket is not.

### What writes where, as of FC-008

| Store | Written by | Read by |
| --- | --- | --- |
| **Cloudflare Images** | `ImageUploadsService.uploadImageToCloudflareImages` — every upload the site accepts | The custom domain and `imagedelivery.net` |
| **Public R2 bucket** | **Nothing.** `uploadImageToCloudflareR2` and `deleteImageFromCloudflareR2` have no callers | Legacy Character portraits, via the two `cdn-cgi` paths above |
| **Quarantine R2 bucket** | `QuarantineStorageService.put` | `FileAssetDeliveryService`, and the scan worker |

The public R2 bucket is kept rather than retired because document uploads are a likely future
feature and Cloudflare Images cannot serve a PDF. See [File assets](file-assets.md) for how such
an upload should reach it — through the asset registry, not through the old image method.

### Proxy Settings

**Cloudflare Proxy:**

- All traffic routed through Cloudflare edge network
- Provides DDoS protection, caching, and security features
- Cloudflare's IPs are what backend sees in `req.ip` (hence need for `CF-Connecting-IP` header)

**IPv6 Support:**

- Cloudflare supports IPv6 by default
- Backend should handle both IPv4 and IPv6 addresses
- Backend normalises IPv6-mapped IPv4 values like `::ffff:192.0.2.1` to `192.0.2.1`

### SSL/TLS Settings

**Encryption Mode:**

- **Full** or **Full (Strict)**: Recommended for production
- Encrypts traffic between client and Cloudflare, and Cloudflare and origin

**Certificates:**

- Cloudflare provides Universal SSL certificate for frontend domains
- Origin server (Render) should use valid certificate
- Render provides SSL for `.onrender.com` domains automatically

**Always Use HTTPS:**

- Enable "Always Use HTTPS" rule in Cloudflare SSL/TLS settings
- Redirects HTTP to HTTPS automatically

> TODO: Document the chosen Cloudflare SSL/TLS mode (Full vs Full Strict) and how origin certificates are handled for Render.

### Page Rules

**Document any Page Rules configured:**

Example rules might include:

- Cache bypass for API endpoints (`api.example.com/*`)
- Custom caching TTL for static assets
- Security headers enforcement

**Current Rules:**

> TODO: List the actual configured Page Rules / Cache Rules (include match patterns like `api.<your-domain>/*`, actions, and notes on why each exists).

### Cloudflare Images

**Purpose:**

- Image optimisation and delivery CDN
- Automatic format conversion (WebP, AVIF)
- On-the-fly resizing and transformations

**Configuration:**

- **Delivery Root URL**: `CLOUDFLARE_CDN_ROOT_URL`
- **Images Hash**: `CLOUDFLARE_IMAGES_HASH`
- **Upload credentials**: Stored in AWS Secrets Manager (not plain env vars)

**Delivery URL Format:**

```
<CLOUDFLARE_CDN_ROOT_URL>/cdn-cgi/imagedelivery/<CLOUDFLARE_IMAGES_HASH>/<IMAGE_ID>/<VARIANT>
```

**Variants:**

- `public`: Default public variant
- `thumbnail`: Smaller size for thumbnails
- Custom variants can be configured in Cloudflare dashboard

**Variants configured on the account — twelve:** `public` (1366x768), `square40`, `square100`,
`square200`, `square300`, `square512`, `banner1200x240`, `banner2400x480`, `cover640x360`,
`cover1920x1080`, `portrait133x200`, `portrait400x600`.

Each is a separate URL for the same object and each keeps working until the image itself is
deleted, which is why withdrawing a published image is a delete rather than a cache operation.
Every object is additionally reachable at `https://imagedelivery.net/<hash>/<id>/<variant>`, a
hostname no purge of the custom domain touches.

**The dashboard is the authority.** Only nine of the twelve are referenced in the backend and two
in the frontend; `square200` and `square512` appear in no repository. They are public URLs for
every image all the same. Adding a variant creates a delivery route that no code change records,
so `scripts/asset-delivery-probe/probe.mjs` keeps its own list and that list has to be updated by
hand when the dashboard changes.

> TODO: Document the dimensions and fit settings for each of the twelve (only `public` is recorded above).

**Upload API:**

Backend uses Cloudflare Images API to upload images:

```
POST https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/images/v1
Authorization: Bearer <Images API key/token (from AWS Secrets Manager)>
```

> TODO: Replace `<ACCOUNT_ID>` with your real Cloudflare account ID, and document whether auth uses an API token vs API key (and where it is stored in Secrets Manager).

### Cloudflare R2

**Purpose:**

- S3-compatible object storage
- Lower cost than Cloudflare Images for storage alone

**Current use: none for writes, but it IS publicly served.** Every image upload goes to Cloudflare
Images; the backend's `uploadImageToCloudflareR2` and `deleteImageFromCloudflareR2` have no
callers. The bucket is nonetheless bound to `cdn.startrekonline.info` and objects in it are
fetched at `<CDN_ROOT>/<key>` — confirmed on 19 September 2026 by putting a canary object in it
and getting a `200`. What is left in it is legacy Character portraits; see
[File assets](file-assets.md) for the query that settles whether any remain, and for why reading
response headers is not a reliable way to test this.

**Configuration:**

- **Bucket Name**: `CLOUDFLARE_R2_BUCKET_NAME`
- **Endpoint**: `CLOUDFLARE_R2_ENDPOINT`
- **Access Credentials**: Stored in AWS Secrets Manager (not plain env vars)

**R2 Bucket Access:**

- Private by default
- Public URLs can be enabled per bucket
- Use presigned URLs for temporary access

### The quarantine bucket

A **second, private R2 bucket**, named by `CLOUDFLARE_R2_QUARANTINE_BUCKET_NAME`, holding uploaded
bytes from the moment they arrive until they have been scanned and published. It is separate from
the delivery bucket rather than a prefix inside it: the delivery bucket is already reachable through
the custom domain, and a prefix would be quarantined only for as long as nobody added a rule, a
redirect or a Worker that reached it.

**One bucket serves every environment**, with the environment as the first key segment
(`prod/assets/…`, `dev/assets/…`), matching the delivery bucket's layout — ADR-0017. R2 cannot scope
a token to a prefix, only to a bucket, so a quarantine credential reaches every environment and must
be treated as a production credential whichever one issued it.

It reuses `CLOUDFLARE_R2_ENDPOINT`: R2's S3 endpoint is scoped to the account, not to a bucket, so
the only new configuration value is the bucket name. A bucket created under a jurisdiction is the
exception — it is reachable only through that jurisdiction's endpoint — which is another reason to
give quarantine the same jurisdiction as the delivery bucket.

It must have, and be checked to have:

- no public access
- no custom domain
- no `r2.dev` subdomain
- no Cloudflare Images variant
- no lifecycle expiry rule, no bucket lock rule and no event notifications
- Data Access Logs enabled
- its own credentials — Object Read & Write for the backend, Object Read only for the worker, both
  scoped to this bucket and neither holding an Admin permission

Nothing in the application can verify any of that. Run `npm run probe:asset-delivery` against the
environment; it attempts every public route to a known quarantined object and reports what answered.
See [File assets](file-assets.md) for the full inventory of delivery paths and what withdrawing an
object costs on each one.

### Two objects in R2 that must not be deleted

| Bucket | Key |
| --- | --- |
| `stoi-quarantine` | `334843800-example-file-q.txt` |
| `stoi-uploads` | `334843800-example-file-cdn.txt` |

These are fixtures for `npm run probe:asset-delivery`, at the bucket root. They look like stray
test files in a bucket listing and their contents say nothing about themselves, which is why they
are recorded here.

Neither has a database record, so nothing will recreate one if it is removed — and **if either is
deleted the probe silently starts reporting `PASS`**, because a key that was never written is
refused by every route exactly as a properly closed one is. See
[File assets](file-assets.md) for what each of them proves.

### Firewall Rules

**Document any firewall rules:**

- IP allow/block lists
- Country blocking
- **User-Agent filtering**: Known automated bots (e.g., GitHub Actions runners) must use a custom `User-Agent: Mozilla/5.0` to bypass WAF blocks for health and version verification checks.
- Rate limiting rules at edge

**Current Rules:**

> TODO: Document the actual Cloudflare Firewall/WAF rules (allow/block lists, country blocks, bot rules) and the rationale for each.

### Caching Rules

**API Endpoints:**

- **Backend API**: Typically bypass cache (dynamic content)
- Backend sets `Cache-Control: no-store` (and related no-cache headers) to prevent caching of API responses

**Static Assets:**

- Frontend static files can be cached aggressively
- Set appropriate `Cache-Control` headers

**Cache Purge:**

- Manual purge via Cloudflare dashboard
- API-based purge for automated workflows

**Cloudflare Cache Levels:**

- Standard: Cache static content based on file extension
- Bypass: Do not cache (for API endpoints)

### DDoS and Rate Limiting (Edge)

**Cloudflare DDoS Protection:**

- Automatic DDoS mitigation at edge
- No configuration needed for basic protection

**Rate Limiting:**

- Configure rate limiting rules in Cloudflare dashboard
- Separate from backend application rate limiting
- Can protect against brute force attacks

**Current Edge Rate Limits:**

> TODO: Document any configured Cloudflare rate limiting rules (routes, thresholds, actions, and whether they differ for auth endpoints).

### Custom Headers to Origin

**Headers Cloudflare Sends to Backend:**

- `CF-Connecting-IP`: Real client IP address
- `CF-Ray`: Unique request identifier for debugging
- `CF-IPCountry`: Country code of client IP
- `X-Forwarded-For`: Client IP chain (may include proxies)
- `X-Forwarded-Proto`: Original protocol (http/https)

**Backend Should Use:**

- `CF-Connecting-IP` for real client IP (most reliable)
- `CF-Ray` for correlating logs with Cloudflare
- `CF-IPCountry` for geo-blocking or analytics (if needed)

### Origin proxy trust

- Backend sets Express `trust proxy` to `TRUST_PROXY_HOPS` (default 1) when not running in `local`
- Client IP used for logging and rate limiting is derived in this order: `CF-Connecting-IP`, then the first `X-Forwarded-For` entry, then Express `req.ip`

## Infrastructure Quirks

### IPv6 Handling

- Cloudflare supports IPv6 natively
- Backend may receive IPv6 addresses in `CF-Connecting-IP`
- Ensure rate limiting and logging handle both IPv4 and IPv6 formats
- PostgreSQL and Node.js handle IPv6 addresses correctly by default

### Render health checks and rate limiting

- Render should hit `GET /health/ready` for readiness checks
- `GET /health/live` can be used for liveness checks
- Backend excludes the `/health/` route prefix from rate limiting

### Cloudflare Proxy Effects

**Visible Origin IP:**

- Backend never sees client's real IP in `req.ip`
- Always use `CF-Connecting-IP` header for accurate client IP

**X-Forwarded-For Header:**

- May contain multiple IPs if client used proxies
- Only trust first IP when from Cloudflare
- Prefer `CF-Connecting-IP` over `X-Forwarded-For`

### Render.com Quirks

**Cold Starts:**

- Free tier services may spin down after inactivity
- First request after spin-down will be slow
- Paid tiers keep services always running

**Deployment Time:**

- Deployments take a few minutes (install, build, start)
- Zero-downtime deploys on paid tiers

**Database Connection Limits:**

- Managed PostgreSQL has connection limits based on plan
- Ensure TypeORM pool size is within limits
- Monitor connection usage in Render dashboard
