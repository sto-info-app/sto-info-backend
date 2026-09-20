# Environment variables

This document lists the environment variables used by the backend at runtime.

## Environment files

- Local development uses `config/environments/.env`.
- `config/environments/template.env` is the template for creating your local `.env`.
- `config/environments/.env.example` is a safe example for hosted environments (e.g. Render) and should match the same keys as `.env`.

Note: the app reads `config/environments/.env` at startup (see `src/main.ts`).

## Required

### Application

- `NODE_ENV`: `local` | `dev` | `staging` | `prod`
- `LOG_LEVEL`: `error` | `warn` | `log` | `debug` | `verbose` (optionally comma-separated)
- `APP_PORT`: Port the HTTP server listens on (default used by code is `3000`)
- `APP_FRONTEND_URL`: Base URL used for CORS and links in emails (e.g. `https://startrekonline.info` in production).
- `APP_TITLE`: Used in email templates and user-facing copy.

### Authentication

- `AUTH_SALT_ROUNDS`: bcrypt rounds for password hashing (Policy: `10` or higher).
- `AUTH_TOKEN_EXPIRES_IN`: Access token expiry in seconds (Policy: `3600` / 1 hour).
- `AUTH_REFRESH_TOKEN_EXPIRES_IN`: Refresh token expiry in seconds (Policy: `14400` / 4 hours).

### Database (TypeORM)

- `DB_TYPE`: `postgres`
- `DB_HOST`: Hostname
- `DB_PORT`: Port (usually `5432`)
- `DB_NAME`: Database name
- `DB_SCHEMA`: Schema name (e.g. `sto_info_app`)
- `DB_USERNAME`: Database username
- `DB_SSL_REJECT_UNAUTHORIZED`: `true` | `false` (used for non-local SSL settings)
- `TYPEORM_SYNCHRONIZE`: `true` | `false` (should be `false` in production)
- `TYPEORM_LOGGING`: `true` | `false`
- `TYPEORM_ENTITIES`: Glob relative to the built root (e.g. `src/**/*.entity.{js,ts}`)
- `TYPEORM_MIGRATIONS`: Glob relative to the built root (e.g. `src/database/migrations/*.{js,ts}`)

### Redis

- `REDIS_URL`: Full connection string for Redis (e.g. `redis://localhost:6379`). Render provides this automatically for managed Redis.
- `QUEUE_PREFIX`: Prefix for BullMQ keys (default `bull:sto-info:`). It must match the file scan worker's, or the two will be talking to different queues in the same Redis and each will look idle to the other.

Redis is used for two unrelated things: rate limiting, and the file scan queues. Since FC-010 it is
**load-bearing for file safety** as well as for throttling — an upload cannot be scanned, and
therefore cannot be published, while it is down. ADR-0006 accepted that and asked for the queue's
connection budget to be sized and monitored separately from the limiter's.

### Email

- `EMAIL_NOREPLY_SENDER`: From address for all outbound email (used by both SES and SendGrid fallback)

### AWS Secrets Manager

- `AWS_ACCESS_KEY_ID`: Used to access Secrets Manager and SES
- `AWS_SECRET_ACCESS_KEY`: Used to access Secrets Manager and SES
- `AWS_REGION`: Region for Secrets Manager and SES
- `AWS_SECRET_NAME`: Name/ARN of the Secrets Manager secret containing application secrets
- `AWS_SNS_TOPIC_ARN`: Full ARN of the SNS topic that receives SES bounce/complaint/delivery feedback (used to validate incoming webhook notifications at `POST /webhooks/ses`)
- `AWS_SES_CONFIGURATION_SET`: Name of the SES Configuration Set attached to this identity; routes events to the SNS topic above

### SES Audit Email Privacy

- `sesEmailHmacSecret` (in **AWS Secrets**): Secret key used to compute HMAC-SHA256 hashes of recipient email addresses. Retrieve this from the secret defined by `AWS_SECRET_NAME`. **Policy**: Key must be a random string of 32-64 bytes. Rotate carefully — changing this key invalidates all existing suppression records.

### Cloudflare

- `CLOUDFLARE_R2_ENDPOINT`: R2 S3-compatible endpoint URL
- `CLOUDFLARE_R2_BUCKET_NAME`: R2 bucket name
- `CLOUDFLARE_CDN_ROOT_URL`: Base Cloudflare URL used to construct delivery URLs
- `CLOUDFLARE_IMAGES_HASH`: Cloudflare Images account hash
- `CLOUDFLARE_R2_QUARANTINE_BUCKET_NAME`: The private bucket uploaded bytes land in before they are scanned

That bucket name is the **only** variable quarantine adds. R2's S3 endpoint is scoped to the
account, not to a bucket, so `CLOUDFLARE_R2_ENDPOINT` reaches the quarantine bucket as well — the
separation that matters is the credentials, not the URL. The one exception is a bucket created
under a [jurisdiction](https://developers.cloudflare.com/r2/reference/data-location/), which is
reachable only through that jurisdiction's own endpoint (`<account>.eu.r2.cloudflarestorage.com`)
and cannot be moved afterwards; giving quarantine a different jurisdiction from the delivery bucket
would mean adding an endpoint variable for it.

> TODO: Confirm the correct `CLOUDFLARE_CDN_ROOT_URL` and `CLOUDFLARE_IMAGES_HASH` values for each environment.

The quarantine bucket is a **separate bucket**, not a prefix in `CLOUDFLARE_R2_BUCKET_NAME`. It must
have no public access, no custom domain, no `r2.dev` subdomain and no Cloudflare Images variant.
Nothing in the application validates that — a config validator cannot see a Cloudflare account — so
it is checked by running `npm run probe:asset-delivery` against the environment.

**One bucket serves every environment**, with the environment as the first key segment, the same way
`CLOUDFLARE_R2_BUCKET_NAME` is laid out. `CLOUDFLARE_R2_QUARANTINE_BUCKET_NAME` therefore holds the
same value in every environment; it stays a configuration value rather than a constant so that a
future split needs no code change. See [File assets](file-assets.md) for the full bucket settings.

### Upload limits

- `MAX_IMAGE_SIZE_IN_BYTES`: Maximum image upload size in bytes (defaults in code to `10485760` = 10 MB)

### Audit retention

- `AUDIT_DATA_NUKE_THRESHOLD_DAYS`: Delete audit/audit-login-attempt rows older than this many days
- `AUDIT_IP_NUKE_THRESHOLD_DAYS`: Null out `ipAddress` in audit/audit-login-attempt rows older than this many days
- `CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS`: Null out masked contact emails older than this many days
- `CONTACT_REQUEST_RECORD_RETENTION_DAYS`: Delete contact requests older than this many days.
- `CLOSED_ACCOUNT_RETENTION_DAYS`: Permanently delete soft-deleted closed-account data after this many days.

Validation rule:

- `CLOSED_ACCOUNT_RETENTION_DAYS` must be greater than or equal to `AUDIT_DATA_NUKE_THRESHOLD_DAYS`.

**Ownership**: Environment variables are managed by Developers (local) and SRE/DevOps (Production - e.g. Render Dashboard). Secrets are managed via the AWS Console or AWS CLI.

## Optional (Storytime)

All default to enabled, so once Storytime itself is switched on its parts work unless an environment deliberately disables one. Set to `false` to disable.

- `STORYTIME_PUBLIC_READ_ENABLED`: Whether Storytime content may be read
- `STORYTIME_CREATION_ENABLED`: Whether Stories may be created and edited
- `STORYTIME_YOUTUBE_ENABLED`: Whether YouTube media may be attached and rendered
- `STORYTIME_SPOTLIGHT_ENABLED`: Whether the Spotlight is surfaced

Creation limits. Each falls back to the value shown if unset or invalid, and an administrator may grant a named user an exemption through the access-control API:

- `STORYTIME_MAX_STORIES_PER_USER` (default `50`)
- `STORYTIME_MAX_CHAPTERS_PER_STORY` (default `200`)
- `STORYTIME_MAX_CHARACTERS_PER_STORY` (default `100`)
- `STORYTIME_MAX_CONTENT_LENGTH` (default `100000`)
- `STORYTIME_UPLOAD_MAX_BYTES` (default `10485760`) — the largest Storytime image accepted. `MAX_IMAGE_SIZE_IN_BYTES` is applied first, by Multer, so an exemption raising a creator above that site-wide ceiling has no effect.

> `STORYTIME_ENABLED` is **not** an environment variable. It is a runtime switch in the `app_setting` table so it can be thrown without a redeployment — see the Feature Switches section of `backend.md`.

## Optional (Custom Tracking)

All default to enabled, so once Custom Tracking itself is switched on its parts work unless an environment deliberately disables one. Set to `false` to disable.

- `CUSTOM_TRACKING_PUBLIC_READ_ENABLED`: Whether anonymous visitors may read public custom content
- `CUSTOM_TRACKING_DEFINITION_EDITING_ENABLED`: Whether users may create and edit definitions
- `CUSTOM_TRACKING_VALUE_EDITING_ENABLED`: Whether users may record and edit values
- `CUSTOM_TRACKING_IMAGES_ENABLED`: Whether image fields may be uploaded to and rendered
- `CUSTOM_TRACKING_YOUTUBE_ENABLED`: Whether YouTube fields may be filled in and rendered

The structural limits are fixed rather than configurable. They decide how large a hierarchy the value editor and the detail pages have to render in one go, so raising one for a single user would produce a page nobody can use on a phone rather than unlocking anything for them. See `custom-tracking.md`.

> `CUSTOM_TRACKING_ENABLED` is **not** an environment variable. It is a runtime switch in the `app_setting` table, seeded off by the feature's first migration, so the feature can be taken offline without a redeployment — which matters here because it stores content users write themselves.

## Optional

- `TRUST_PROXY_HOPS`: Express trust proxy hops (default is `1` when not provided)
- `STARTUP_DIAGNOSTICS`: `true` | `false` (default `false`). When `true`, logs process memory usage (RSS/heap/external) at key startup stages to help diagnose intermittent memory jumps.
- `FUZZ_NUM_RUNS`: Number of iterations for property-based fuzz tests (default `100` for light tests, `1000` for full tests). Used by `fast-check`.

## Optional (dev-only seeding)

These are read by seeders when `NODE_ENV` is not `prod`.

- `DATASEED_USER_EMAIL`
- `DATASEED_USER_USERNAME`
- `DATASEED_USER_FIRSTNAME`
- `DATASEED_USER_LASTNAME`
- `DATASEED_USER_PASSWORD`

## AWS Secrets Manager secret shape

The secret referenced by `AWS_SECRET_NAME` is expected to be JSON with at least:

- `jwtSecret`: Used to sign JWT access tokens
- `dbPassword`: Used as the PostgreSQL password for TypeORM
- `sendGridApiKey`: Used by SendGrid for outbound email (fallback when SES fails)
- `cloudflareR2AccessKey`: Used to write objects to Cloudflare R2
- `cloudflareR2Secret`: Used to write objects to Cloudflare R2
- `cloudflareImagesAccountId`: Used for Cloudflare Images uploads
- `cloudflareImagesApiKey`: Used for Cloudflare Images uploads
- `cloudflareR2QuarantineAccessKey`: Reads and writes the private quarantine bucket
- `cloudflareR2QuarantineSecret`: Reads and writes the private quarantine bucket

`cloudmersiveApiKey` is **no longer read**. FC-012 removed the synchronous scanner call along
with the last caller that used it; malware scanning is ClamAV in the file scan worker, whose
credentials are the worker's own. The key may be removed from the secret once nothing else in
the estate refers to it.

The quarantine credentials are deliberately separate from `cloudflareR2AccessKey`. The key that
publishes must not be able to read quarantine, and the key that reads quarantine must not be able to
publish; a shared credential would put back exactly what the separate bucket exists to prevent.

## Validation

- Startup validation runs via `ConfigCheckService`; missing or invalid required values will stop the app from starting.

### Process memory diagnostics

- `MEMORY_DIAGNOSTICS_ENABLED`: `true` or `false`; defaults to `false` in every environment.
- `MEMORY_DIAGNOSTICS_INTERVAL_MINUTES`: defaults to `10`. Finite numeric minutes corresponding to 1–2,147,483,647 milliseconds; invalid supplied settings fail startup even when diagnostics are disabled.
- Diagnostics use Nest's normal `log` level. Set `LOG_LEVEL=log` (or include `log` in an explicit list) in Render alongside `MEMORY_DIAGNOSTICS_ENABLED=true`. This also enables other application logs at that level. No console fallback is used.

A startup sample after module initialisation establishes the baseline. Periodic samples emit process uptime, all `process.memoryUsage()` fields, V8 used/total heap, heap limit, malloced memory and external memory, in bytes. RSS and used-heap deltas compare with the preceding periodic/startup sample and the startup baseline. Only those two pairs of numbers are retained; no history is accumulated.

Counters cover HTTP requests admitted by guards, authenticated requests with `req.user`, explicit GET requests to the app-state handler, and individual cleanup job attempts. Guard-rejected, rate-limited, unmatched and preflight requests that never reach a controller are excluded. Counts reset only on periodic samples. Each of the six nightly cleanup jobs logs before and after (also on failure); these samples show interval-to-date counters without resetting them or changing the periodic baseline. Concurrent traffic may affect cron snapshots, which do not measure retained memory attributable solely to a job.

The timer is unreferenced and cleared on Nest shutdown; SIGTERM/SIGINT invoke shutdown hooks. There is no forced GC, snapshot-file capture, automatic restart, dependency change or cleanup behaviour change. Disable with `MEMORY_DIAGNOSTICS_ENABLED=false` and redeploy.

#### Enable in Render

1. Open the backend service for the intended environment in Render and open its Environment settings. Record the existing `LOG_LEVEL` value so it can be restored afterwards.
2. Set:

   ```env
   MEMORY_DIAGNOSTICS_ENABLED=true
   MEMORY_DIAGNOSTICS_INTERVAL_MINUTES=10
   LOG_LEVEL=log
   ```

   If using an explicit comma-separated `LOG_LEVEL` list, add `log` while preserving the other levels. An existing `debug` or `verbose` setting already includes normal logs. Enabling `log` also exposes other application logs at that level.
3. Save the settings and deploy/restart the service with the updated environment. These settings are read at startup; changing a value without restarting the process does not update the sampler.
4. Filter the service logs for `MemoryDiagnosticsService`. After initialisation, expect a JSON message with `reason` set to `startup`, followed by `interval` every ten minutes. Cleanup executions additionally emit labels such as `audit-cleanup:before` and `audit-cleanup:after`.

If no samples appear, check that the running deployment contains the diagnostics code, `MEMORY_DIAGNOSTICS_ENABLED` is exactly `true`, and `LOG_LEVEL` includes `log`. Invalid diagnostic settings fail startup and must be corrected before retrying the deployment.

#### Disable in Render

1. Set `MEMORY_DIAGNOSTICS_ENABLED=false`, or remove it to use the disabled default. The interval can remain set to `10` or be removed.
2. Restore the previous `LOG_LEVEL` if it was changed solely for this investigation.
3. Save and deploy/restart the service. The replacement process will not start the diagnostic timer or update diagnostic counters. Verify that no new `MemoryDiagnosticsService` samples appear from that process; historical logs remain available.

Changing only `LOG_LEVEL` hides the samples but does not disable collection. Use `MEMORY_DIAGNOSTICS_ENABLED=false` to turn diagnostics off.

For local/development runs, set the same variables in the environment used to launch the backend and restart it. `STARTUP_DIAGNOSTICS` is a separate bootstrap-only switch: enabling or disabling it does not change periodic memory diagnostics. If it was also enabled during the investigation, set `STARTUP_DIAGNOSTICS=false` separately when finished.
