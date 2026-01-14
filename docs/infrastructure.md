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

Optional (diagnostics):

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
- `cdn.startrekonline.info`: Cloudflare R2 Images CDN

**Development Domains:**

- `dev.startrekonline.info`: Development frontend
- `dev-api.startrekonline.info`: Development backend API
- `dev-cdn.startrekonline.info`: Development Cloudflare R2 Images CDN

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

> TODO: Document the exact variant names used by the app (and the Cloudflare Images variant settings for each).

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
- Stores original image files or backups
- Lower cost than Cloudflare Images for storage alone

**Configuration:**

- **Bucket Name**: `CLOUDFLARE_R2_BUCKET_NAME`
- **Endpoint**: `CLOUDFLARE_R2_ENDPOINT`
- **Access Credentials**: Stored in AWS Secrets Manager (not plain env vars)

**R2 Bucket Access:**

- Private by default
- Public URLs can be enabled per bucket
- Use presigned URLs for temporary access

### Firewall Rules

**Document any firewall rules:**

- IP allow/block lists
- Country blocking
- User-Agent filtering
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
