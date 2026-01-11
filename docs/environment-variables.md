# Environment variables

This document lists the environment variables used by the backend at runtime.

## Required

### Application

- `NODE_ENV`: `local` | `dev` | `prod`
- `APP_PORT`: Port the HTTP server listens on (default used by code is `3000`)
- `APP_FRONTEND_URL`: Base URL used for CORS and links in emails
- `APP_TITLE`: Used in email templates and user-facing copy

> TODO: Document the exact prod/dev values for `APP_FRONTEND_URL` and where they are configured (Render service env vars vs local `.env`).

### Authentication

- `AUTH_SALT_ROUNDS`: bcrypt rounds used for password hashing and refresh token hashing
- `AUTH_TOKEN_EXPIRES_IN`: Access token expiry in seconds
- `AUTH_REFRESH_TOKEN_EXPIRES_IN`: Refresh token expiry in seconds

> TODO: Record the chosen production values for `AUTH_SALT_ROUNDS`, `AUTH_TOKEN_EXPIRES_IN`, and `AUTH_REFRESH_TOKEN_EXPIRES_IN`.

### Database (TypeORM)

- `DB_TYPE`: `postgres`
- `DB_HOST`: Hostname
- `DB_PORT`: Port (usually `5432`)
- `DB_NAME`: Database name
- `DB_SCHEMA`: Schema name (e.g. `sto_info_app`)
- `DB_USERNAME`: Database username
- `TYPEORM_SYNCHRONIZE`: `true` | `false` (should be `false` in production)
- `TYPEORM_LOGGING`: `true` | `false`
- `TYPEORM_ENTITIES`: Glob relative to the built root (e.g. `src/**/*.entity.{js,ts}`)
- `TYPEORM_MIGRATIONS`: Glob relative to the built root (e.g. `src/database/migrations/*.{js,ts}`)

### Email

- `SENDGRID_NOREPLY_SENDER`: From address for outbound email

### AWS Secrets Manager

- `AWS_ACCESS_KEY_ID`: Used to access Secrets Manager
- `AWS_SECRET_ACCESS_KEY`: Used to access Secrets Manager
- `AWS_REGION`: Region for Secrets Manager
- `AWS_SECRET_NAME`: Name/ARN of the Secrets Manager secret containing application secrets

> TODO: Document the actual secret name/ARN used per environment and who has access to manage/rotate it.

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

> TODO: Confirm the retention thresholds used in production and the rationale (privacy/compliance requirements).

## Optional

- `TRUST_PROXY_HOPS`: Express trust proxy hops (default is `1` when not provided)
- `DB_SSL_REJECT_UNAUTHORIZED`: `true` | `false` (used for non-local SSL settings)

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
- `sendGridApiKey`: Used by SendGrid for outbound email
- `cloudflareR2AccessKey`: Used to write objects to Cloudflare R2
- `cloudflareR2Secret`: Used to write objects to Cloudflare R2
- `cloudflareImagesAccountId`: Used for Cloudflare Images uploads
- `cloudflareImagesApiKey`: Used for Cloudflare Images uploads
- `cloudmersiveApiKey`: Used for virus scanning of uploads

## Validation

- Startup validation runs via `ConfigCheckService`; missing or invalid required values will stop the app from starting.
