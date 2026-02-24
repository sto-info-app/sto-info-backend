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

> TODO: Confirm the correct `CLOUDFLARE_CDN_ROOT_URL` and `CLOUDFLARE_IMAGES_HASH` values for each environment.

### Upload limits

- `MAX_IMAGE_SIZE_IN_BYTES`: Maximum image upload size in bytes (defaults in code to `10485760` = 10 MB)

### Audit retention

- `AUDIT_DATA_NUKE_THRESHOLD_DAYS`: Delete audit/audit-login-attempt rows older than this many days
- `AUDIT_IP_NUKE_THRESHOLD_DAYS`: Null out `ipAddress` in audit/audit-login-attempt rows older than this many days
- `CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS`: Null out masked contact emails older than this many days
- `CONTACT_REQUEST_RECORD_RETENTION_DAYS`: Delete contact requests older than this many days.

**Ownership**: Environment variables are managed by Developers (local) and SRE/DevOps (Production - e.g. Render Dashboard). Secrets are managed via the AWS Console or AWS CLI.

## Optional

- `TRUST_PROXY_HOPS`: Express trust proxy hops (default is `1` when not provided)
- `STARTUP_DIAGNOSTICS`: `true` | `false` (default `false`). When `true`, logs process memory usage (RSS/heap/external) at key startup stages to help diagnose intermittent memory jumps.

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
- `cloudmersiveApiKey`: Used for virus scanning of uploads

## Validation

- Startup validation runs via `ConfigCheckService`; missing or invalid required values will stop the app from starting.
