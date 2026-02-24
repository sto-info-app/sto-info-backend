# Database Documentation (PostgreSQL)

## Schema Overview

The database uses PostgreSQL with TypeORM for object-relational mapping.

### Main Entities

| Entity                    | Table                  | Description                                                                   |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `UserEntity`              | `user`                 | User accounts, credentials, and profile                                       |
| `UserRefreshTokenEntity`  | `user_refresh_token`   | Active refresh tokens (revoked/expired cleaned nightly)                       |
| `AuditEntity`             | `_audit`               | General entity change audit log                                               |
| `AuditLoginAttemptEntity` | `_audit_login_attempt` | Login attempt history (email + IP + success flag)                             |
| `SesEventEntity`          | `_audit_ses_event`     | SES bounce/complaint/delivery audit events (email stored as HMAC-SHA256 hash) |
| `ContactRequestEntity`    | `contact_request`      | Contact form submissions                                                      |
| `PlatformEntity`          | `platform`             | STO platform reference data                                                   |
| `LauncherEntity`          | `launcher`             | STO launcher reference data                                                   |
| `PlatformLauncherEntity`  | `platform_launcher`    | Platform/launcher mapping                                                     |
| `AccountEntity`           | `account`              | STO in-game account records                                                   |
| `CharacterEntity`         | `character`            | STO character profiles linked to accounts                                     |

### Entity Relationships

**Document relationships:**

> TODO: Confirm the real relationships (including cascade/delete behaviour) and update this section to match the entities.

- User has many Characters (one-to-many)
- Other relationships as applicable

### Key Fields

**Normalised Handles/Slugs:**

- Users and Characters have `handle` and `handleNormalized` fields
- `handleNormalized`: Lowercase, URL-safe version of handle for uniqueness and lookups
- Used for SEO-friendly URLs and case-insensitive searches

**Timestamps:**

- `createdDate`: Record creation timestamp
- `updatedDate`: Last modification timestamp (auto-updated)
- `deletedDate`: Soft delete timestamp (if using soft deletes)

## Migrations

### Migration Strategy

- **TypeORM Migrations**: All schema changes must be done via migrations
- Never modify entities and sync directly in production
- Always generate and review migrations before running

### Creating Migrations

**Generate from Entity Changes:**

```bash
npm run migration:generate -- -n MigrationName
```

This compares current entities with database schema and generates a migration.

**Create Empty Migration:**

```bash
npm run migration:create -- -n MigrationName
```

Manually write the `up()` and `down()` methods.

### Running Migrations

**Execute Pending Migrations:**

```bash
npm run migration:run
```

**Revert Last Migration:**

```bash
npm run migration:revert
```

### Migration Best Practices

1. **Always Review**: Check generated migrations before running
2. **Test Locally**: Run migrations on local database first
3. **Backup First**: In production, backup database before migrations
4. **Reversible**: Ensure `down()` method correctly reverts changes
5. **Data Migrations**: Handle data transformations carefully

### Common Migration Pitfalls

**Missing Columns:**

If migration references a column that doesn't exist yet, ensure migrations run in correct order or split into multiple migrations.

**Example Issue:**

The `handleNormalized` column migration failed because it expected the column to already exist. Solution: Ensure column creation happens before any operations on it.

**Constraint Conflicts:**

Adding unique constraints may fail if existing data violates uniqueness. Clean or migrate data first.

## Indexes

### Custom Indexes

**Document important indexes:**

> TODO: Confirm which indexes/unique constraints exist in production (from migrations) and document the important ones here.

- `handleNormalized` on User and Character tables (for fast lookups)
- Email on User table (unique, for authentication)
- Foreign keys (usually auto-indexed)

### Index Purposes

- **Performance**: Speed up frequent queries
- **Uniqueness**: Enforce unique constraints
- **Foreign Keys**: Improve join performance

## Constraints and Triggers

**Document any database constraints:**

- Unique constraints (e.g., email, handleNormalized)
- Check constraints (e.g., valid email format)
- Foreign key constraints

**Document any triggers:**

Currently: Review if any triggers are in use.

> TODO: Verify whether any triggers exist (and document them if they do).

## Data Retention Policies

**Current behaviour in code:**

| Table                                 | Retention behaviour                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `_audit`                              | Records deleted after `AUDIT_DATA_NUKE_THRESHOLD_DAYS` days; `ipAddress` nulled after `AUDIT_IP_NUKE_THRESHOLD_DAYS` days              |
| `_audit_login_attempt`                | Records deleted after `AUDIT_DATA_NUKE_THRESHOLD_DAYS` days; `ipAddress` nulled after `AUDIT_IP_NUKE_THRESHOLD_DAYS` days              |
| `_audit_ses_event` (`suppress=false`) | Delivery and soft bounce records deleted after `SES_AUDIT_RETENTION_DAYS` days (policy: **180 days**)                                  |
| `_audit_ses_event` (`suppress=true`)  | Hard bounce and complaint records deleted after `SES_SUPPRESSION_RETENTION_DAYS` days (policy: **7 years / 2557 days**)                |
| `contact_request`                     | Email masked after `CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS` days; record deleted after `CONTACT_REQUEST_RECORD_RETENTION_DAYS` days |
| `user_refresh_token`                  | Expired and revoked tokens deleted nightly                                                                                             |

### SES Audit Storage & Ownership

It is important to note that **Amazon SES does not store this audit data long-term.**

1. **Origin**: SES generates events (Bounce, Complaint, Delivery, Reject).
2. **Transit**: Events are pushed immediately via **AWS SNS** to the application's `/webhooks/ses` endpoint.
3. **Storage**: The application processes the event and persists it to the `_audit_ses_event` table in the local PostgreSQL database (storing only HMAC-SHA256 hashes of email addresses).
4. **Retention**: The application's daily maintenance job handles the deletion of these records according to the privacy policy.

For full consistency with the privacy policy, ensure any CloudWatch Log Groups associated with SES reputation metrics are also configured with a retention period of **no more than 180 days** in the AWS Console.

> Note: The `_audit_ses_event` table never stores plaintext email addresses. The `emailHashed` column holds an HMAC-SHA256 digest keyed by `SES_EMAIL_HMAC_SECRET`. See `docs/environment-variables.md` for rotation implications.

**Define project rules here:**

- User account data: retained until deletion is requested
- Character data: retained until user deletes it or account is deleted
- Uploaded images: define whether deletions remove the backing object from R2/Cloudflare Images
- Backups: define Render backup retention and restoration expectations

> TODO: Decide and document the intended retention/deletion behaviour for uploaded images (DB references, Cloudflare Images, and any R2 objects).
> TODO: Document the real backup retention, RPO/RTO expectations, and a restore runbook.

## Connection Pool Settings

**TypeORM Connection Configuration:**

Review `ormconfig.ts` or database module configuration for:

> TODO: Confirm where pool settings are configured in this repo (and document the actual values used in prod).

- `maxConnections`: Maximum pool size
- `minConnections`: Minimum pool size
- `connectionTimeout`: Connection timeout in milliseconds
- `idleTimeout`: Idle connection timeout

**Render.com Managed PostgreSQL:**

- Connection limits depend on Render plan
- Review plan limits and adjust pool size accordingly
- Monitor connection usage in Render dashboard

## Timezone

- On startup the backend sets the database timezone to UTC (`SET TIME ZONE 'UTC'`)

## Seed behaviour

- Seeders run automatically on module init in non-production environments
- User seeding is skipped when `NODE_ENV=prod`
- Seed user is created only if all `DATASEED_USER_*` variables are provided

## Database Backup Strategy

**Render.com Backups:**

- Managed PostgreSQL includes automatic backups
- Check Render dashboard for backup schedule and retention
- Point-in-time recovery may be available depending on plan

**Manual Backups:**

```bash
pg_dump -h <host> -U <user> -d <database> > backup.sql
```

> TODO: Replace `<host>`, `<user>`, and `<database>` with the real Render connection values (or document where to retrieve them safely).

**Restore:**

```bash
psql -h <host> -U <user> -d <database> < backup.sql
```

> TODO: Document any required flags for SSL (`sslmode=require`) and the expected restore procedure for Render-managed Postgres.

**Backup Before Migrations:**

Always backup production database before running migrations.

## Normalised Handle/Slug Generation

### Purpose

- Provides URL-friendly, case-insensitive unique identifiers
- Used for SEO-friendly URLs (e.g., `/characters/my-character-name`)
- Enables fast lookups without case sensitivity issues

### Generation Logic

**Input:** User-provided handle (e.g., "My Character")

**Output:** Normalised handle (e.g., "my-character")

**Process:**

1. Convert to lowercase
2. Replace spaces with hyphens
3. Remove or replace special characters
4. Ensure uniqueness (append number if duplicate)

**Implementation:**

Check entity lifecycle hooks or service methods for normalisation logic.

### Uniqueness Enforcement

- Database unique constraint on `handleNormalized`
- Prevents duplicate slugs
- If duplicate detected, append incrementing number (e.g., "my-character-2")
