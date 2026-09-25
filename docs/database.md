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
| `PlatformLauncherEntity`  | `platform_launcher`    | Platform/launcher mapping and account background image URL rules              |
| `AccountEntity`           | `account`              | STO in-game account records                                                   |
| `CharacterEntity`         | `character`            | STO character profiles linked to accounts                                     |
| `FileAssetEntity`         | `file_asset`           | Every stored file: its identity, hash, state and audience — see [File assets](file-assets.md) |
| `FileAssetPlacementEntity` | `file_asset_placement` | Which record and slot a picture is for, and what is on its way to one — see [File assets](file-assets.md) |
| `RosterImportSourceEntity` | `fleet_roster_import_source` | What is known about an uploaded roster export once the export itself has been discarded — see [Roster imports](roster-imports.md) |
| `RosterIdentityEntity` | `fleet_roster_identity` | A UUID for somebody a Fleet's roster listed, needing no STO Info account — see [Roster identities](roster-identities.md) |
| `RosterIdentityAliasEntity` | `fleet_roster_identity_alias` | One exact Character name and handle in a Fleet, and which identity it belongs to |
| `RosterIdentityCandidateEntity` | `fleet_roster_identity_candidate` | A Character or account rename the evidence suggests, and where a reviewer has left it |
| `RosterIdentityCandidateLinkEntity` | `fleet_roster_identity_candidate_link` | Each pair of aliases a rename candidate would join |
| `RosterIdentityDecisionEntity` | `fleet_roster_identity_decision` | Each confirm, reject or undo on a candidate, write-once |
| `RosterImportConflictEntity` | `fleet_roster_import_conflict` | Exports of one Fleet that claim one moment and disagree, and the one an investigator selected |
| `RosterImportActionEntity` | `fleet_roster_import_action` | Each exclusion, reinstatement, partial mark, row exclusion, timezone correction and selection, with who and why, write-once — see [Roster history](roster-history.md#corrections) |
| `RosterProjectionEntity` | `fleet_roster_projection` | Which revision of a Fleet's roster history is published, and whether a newer one has been asked for — see [Roster history](roster-history.md) |
| `RosterProjectionInputEntity` | `fleet_roster_projection_input` | What a revision made of each import it considered |
| `RosterEpisodeEntity` | `fleet_roster_episode` | One stretch of one identity's membership, bounded by exports |
| `RosterChangeEntity` | `fleet_roster_change` | One change to one member between two exports |
| `RosterIntervalSummaryEntity` | `fleet_roster_interval_summary` | What happened between two consecutive effective exports |
| `RosterRankOrderEntity` | `fleet_roster_rank_order` | Which tier each of a Fleet's rank labels is in, when an investigator has ordered them — see [Roster history](roster-history.md#rank-order) |
| `RosterRankOrderActionEntity` | `fleet_roster_rank_order_action` | Each edit to a Fleet's rank order, the order before and after, with who and why, write-once |
| `FleetReportAudienceEntity` | `fleet_report_audience` | Who the Owner has let see each of a Fleet's reports; a report with no row is private |
| `FleetReportAudienceChangeEntity` | `fleet_report_audience_change` | Each change to a report's audience, from what to what and who made it, write-once |

### Platform Launcher Image Mapping

The `platform_launcher` table now stores account background image URL rules used by
the account list API.

- `id` (uuid): Surrogate primary key.
- `platformId` (nullable): Platform-specific match target.
- `launcherId` (nullable): Launcher-specific match target.
- `backgroundImageUrl` (nullable): Cloudflare Images delivery URL.

Resolution precedence used by the API:

1. Exact platform + launcher row.
2. Platform default row (`platformId` + `launcherId=NULL`).
3. Launcher default row (`platformId=NULL` + `launcherId`).
4. Global default row (`platformId=NULL` + `launcherId=NULL`).
5. Static fallback URL in service code.

Uniqueness is enforced using partial unique indexes per mapping pattern,
instead of a single `(platformId, launcherId)` unique constraint.

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

### Custom Tracking

Three constraints here do work a service could only do less reliably, so they
are worth knowing about before changing the tables:

| Constraint | Table | What it guarantees |
| --- | --- | --- |
| `CK_custom_tracking_value_target` | `custom_tracking_value` | A value names an Account or a Character, never both and never neither |
| `FK_custom_tracking_value_field` | `custom_tracking_value` | Composite key on `(fieldId, targetScope)`, so an Account value cannot be recorded against a Character-scoped field. Needs `UX_custom_tracking_field_id_scope` on the field table |
| `FK_custom_tracking_value_option_option` | `custom_tracking_value_option` | `ON DELETE RESTRICT`, so a withdrawn option cannot be hard-deleted while any value still names it — however long that outlasts its retention window |
| `UX_custom_tracking_image_cleanup_image` | `custom_tracking_image_cleanup` | One row per Cloudflare image, so queueing the same picture twice — a retried replacement, a sweep that ran twice — writes the same row rather than a second one to delete twice |

Sibling-name uniqueness across the definition hierarchy is a set of **partial**
unique indexes covering only rows where `deletedAt IS NULL`. That is what lets
a name be reused once its definition is deleted, while still refusing two live
siblings with the same name under concurrent creation.

One live answer per field and target is **two** partial unique indexes rather
than one, because a null does not compare equal to anything in SQL: a single
index over both target columns would let the same Account be answered twice.

**Document any database constraints:**

- Unique constraints (e.g., email, handleNormalized)
- Check constraints (e.g., valid email format)
- Foreign key constraints

### File assets

| Constraint | Table | What it guarantees |
| --- | --- | --- |
| `TR_file_asset_guard` | `file_asset` | See below |
| `CHK_file_asset_scope_audience` | `file_asset` | A scope audience is held if and only if the audience is `SCOPE`, so no row carries a visibility rule it never consults |
| `CHK_file_asset_scope_named` | `file_asset` | A scoped asset names exactly one Community, Fleet or Armada, so nothing is published to the members of nothing |
| `CHK_file_asset_available_object` | `file_asset` | An `AVAILABLE` asset has an object key and a real storage location, so "available" cannot mean "published, location unknown" |
| `UX_file_asset_object` | `file_asset` | One row per stored object, so one set of bytes cannot acquire two verdicts and two audiences. Partial, so assets registered but not yet stored do not collide on a null key |
| `FK_file_asset_owner` | `file_asset` | `ON DELETE SET NULL`, so deleting an account severs the personal link without destroying the record that tells the cleanup cron an object exists |
| `UX_file_asset_delivery_reference` | `file_asset` | One delivered object belongs to one asset, so the lookup behind every delete cannot find two rows disagreeing about whether a purge is owed |
| `TR_file_asset_placement_guard` | `file_asset_placement` | See below |
| `UX_file_asset_placement_pending` | `file_asset_placement` | At most one upload is on its way to a slot, so a second upload supersedes the first rather than racing it |
| `UX_file_asset_placement_active` | `file_asset_placement` | At most one picture is what a slot shows, so there are never two answers to that question |
| `CHK_file_asset_placement_settled` | `file_asset_placement` | A pending placement has not settled and a settled one has, which is what the nightly sweep measures abandonment against |
| `CHK_file_asset_placement_subject_id` | `file_asset_placement` | A placement names the record it is for |
| `FK_file_asset_placement_asset` | `file_asset_placement` | `ON DELETE RESTRICT`, because an asset row is evidence that bytes existed and withdrawal is a state rather than a delete |

**Triggers:**

`TR_file_asset_guard` is the only trigger in the schema. It runs `BEFORE UPDATE` on `file_asset`
and raises a check violation (`23514`) in four cases:

1. `objectKey` changed once it held a value;
2. `objectVersion` changed once it held a value;
3. `sha256` changed once it held a value;
4. `state` set to `AVAILABLE` from anything but `AVAILABLE`, `CLEAN` or `UNVERIFIED`.

The first three make object identity write-once, so a verdict cannot be transferred to different
bytes by editing a row — replacing a file means registering a new asset, which gets its own
verdict. The fourth means there is no sequence of writes that publishes a file a scanner refused or
an administrator withdrew.

**`deliveryReference` is deliberately not one of the write-once columns.** It is where the object
is served from now, which changes when an asset is published, whereas `objectKey` is the key the
bytes were hashed under and does not. FC-012's migration copied the estate's object keys into it,
so one column answers "what has to be deleted to withdraw this" for rows written before the
registry existed and rows written since.

`TR_file_asset_placement_guard` runs `BEFORE UPDATE` on `file_asset_placement` and raises the same
check violation in two cases:

1. the asset, the subject, the subject identifier or the slot changed — placement identity is
   write-once, so a refused upload cannot be turned into an accepted one by an `UPDATE`;
2. the state returned to `PENDING` — without which a placement the nightly sweep had abandoned
   could be revived after its bytes had been dropped.

### Roster identities

| Constraint | Table | What it guarantees |
| --- | --- | --- |
| `UX_roster_identity_alias_key` | `fleet_roster_identity_alias` | One alias per Fleet and exact normalised name and handle, so a recompute finds the alias it made last time and identity UUIDs survive it |
| `UQ_roster_identity_alias_origin` | `fleet_roster_identity_alias` | Every alias is born with an identity of its own, which is where it returns when a merge is undone |
| `FK_roster_identity_alias_identity`, `FK_roster_identity_candidate_from`, `FK_roster_identity_candidate_link_from` and their pairs | alias, candidate, link | Through `(id, fleetId)`, so no row can join one Fleet's evidence to another's |
| `CHK_roster_identity_candidate_kind` | `fleet_roster_identity_candidate` | A Character rename has an alias pair and no handles; an account rename has a handle pair and no aliases |
| `CHK_roster_identity_candidate_collision_open` | `fleet_roster_identity_candidate` | A candidate with collision reasons stays `OPEN`: it can be seen and not decided |
| `UX_roster_identity_candidate_character`, `UX_roster_identity_candidate_account` | `fleet_roster_identity_candidate` | One candidate per alias pair, or handle pair, per Fleet, so a rejected one is found again rather than suggested again |
| `UX_roster_identity_decision_revision` | `fleet_roster_identity_decision` | Decisions are numbered per candidate, so two reviewers cannot both record the next one |
| `TR_roster_identity_decision_guard` | `fleet_roster_identity_decision` | Refuses any change to a decision except its actor being cleared when their account is deleted |

### Roster corrections and history

| Constraint | Table | What it guarantees |
| --- | --- | --- |
| `UX_roster_import_conflict_instant` | `fleet_roster_import_conflict` | One group per Fleet and instant, settled or not, so a newcomer for a settled moment reopens its group rather than starting another |
| `FK_roster_import_conflict_selected` | `fleet_roster_import_conflict` | Through `(selectedImportId, id)` to the import's `(id, conflictGroupId)`, so a group can only select one of its own exports |
| `CHK_roster_import_conflict_selected` | `fleet_roster_import_conflict` | A settled group always has a selection |
| `CHK_roster_import_action_reason` | `fleet_roster_import_action` | Every correction gives a reason that is not blank |
| `CHK_roster_import_action_conflict` | `fleet_roster_import_action` | A selection names its group, and nothing else does |
| `TR_roster_import_action_guard` | `fleet_roster_import_action` | Refuses any change to a correction except its actor being cleared when their account is deleted |
| `CHK_roster_projection_counters` | `fleet_roster_projection` | `built` never passes `requested` |
| `CHK_roster_projection_published` | `fleet_roster_projection` | A revision other than 0 has been published |
| `FK_roster_episode_identity` | `fleet_roster_episode` | Through `(identityId, fleetId)`, so no episode joins one Fleet's history to another's |
| `FK_roster_change_episode` | `fleet_roster_change` | Through Fleet, revision, identity and ordinal, so a change belongs to an episode of its own revision |
| `CHK_roster_change_delta` | `fleet_roster_change` | A contribution delta only on a rise, and only above zero: a fall is a reset, never a negative donation |
| `CHK_roster_episode_end` | `fleet_roster_episode` | An ended episode says by when; only a departure names the export that proved it |
| `PK_roster_rank_order` | `fleet_roster_rank_order` | Each label is placed at most once per Fleet |
| `CHK_roster_rank_order_tier` | `fleet_roster_rank_order` | Tiers count from 1, the highest |
| `CHK_roster_rank_order_action_reason` | `fleet_roster_rank_order_action` | Every edit gives a reason that is not blank |
| `CHK_roster_rank_order_action_tiers` | `fleet_roster_rank_order_action` | Both orders are JSON lists of tiers |
| `TR_roster_rank_order_action_guard` | `fleet_roster_rank_order_action` | Refuses any change to an edit except its actor being cleared when their account is deleted |
| `PK_fleet_report_audience` | `fleet_report_audience` | One audience per Fleet and report |
| `CHK_fleet_report_audience_change_moved` | `fleet_report_audience_change` | A change records a move to a different audience |
| `TR_fleet_report_audience_change_guard` | `fleet_report_audience_change` | Refuses any change to a record except its actor being cleared when their account is deleted |

Every derived table carries its revision, and a rebuild writes the next beside the published one
before switching to it. The derived tables cascade from their Fleet and imports; they hold nothing
a replay cannot rebuild.

### Roster import provenance

| Constraint | Table | What it guarantees |
| --- | --- | --- |
| `TR_roster_import_source_guard` | `fleet_roster_import_source` | See below |
| `UQ_roster_import_source_asset` | `fleet_roster_import_source` | One import record per stored object, so there is never more than one answer to which export produced a given file |
| `CHK_roster_import_source_source_hash` | `fleet_roster_import_source` | Lowercase hexadecimal. The source hash is the only surviving evidence of the uploaded file, and a malformed one looks like evidence while answering nothing |
| `CHK_roster_import_source_officer_rows` | `fleet_roster_import_source` | The officer-tail count is between zero and the row count |
| `CHK_roster_import_source_officer_shape` | `fleet_roster_import_source` | A twelve-column export discarded no officer notes, so a non-zero count against a `NORMAL` header means the parser and the record disagree about what arrived |
| `FK_roster_import_source_asset` | `fleet_roster_import_source` | `ON DELETE RESTRICT`, so the registry row cannot be removed while the record of where its bytes came from still stands |
| `FK_roster_import_source_user` | `fleet_roster_import_source` | `ON DELETE SET NULL`, matching `file_asset`: closing an account severs the personal link and does not destroy the evidence that an import happened |

**Triggers:**

`TR_roster_import_source_guard` runs `BEFORE UPDATE` and raises a check violation (`23514`) if the
asset, the Fleet, the filename, the content type the upload claimed, either hash, either size, the
header shape, the parser version or the upload time changes. The row is the answer to "what was actually uploaded", and an answer that
can be edited afterwards is not evidence; a correction means a new import, not a rewritten record.

The two counts stay mutable, because a recount is a correction to a derived figure rather than to
the record of the upload.

**The guard names its columns one at a time**, so a column added to this table and forgotten
here is silently editable. FC-011 added `declaredContentType` and replaced the function to
include it; the rehearsal asserts every name in the list, which is what makes the omission a
failing test rather than a discovery.

It is a trigger rather than a service check because both properties have to hold against every
future caller, including a migration, a repair script and a hand-typed `UPDATE`, rather than
against the callers that exist today.

### A second schema, owned by the file scan worker

`sto_info_app` is not the only schema in this database. The file scan worker owns
`sto_info_worker`, migrates it itself, and keeps its own `_migrations` table inside it.

[ADR-0006](../../../Plans/Fleets/ADR/0006-worker-job-transport-and-ownership.md) split schema
ownership by table and warned that two migration owners against one database "needs care:
separate TypeORM migration tables, no overlapping table names". Both repositories had in fact
named their migration table `_migrations`; in one schema they would have shared it, and each
would have read the other's history as its own. FC-010 gave the worker a schema instead.

Three consequences for anybody working in this repository:

- **Do not migrate `sto_info_worker`, and do not read or write anything in it.** The contract
  between the two applications is the two queue messages, not the tables.
- **`sto_info_worker.file_scan_attempt` holds a foreign key into `file_asset`**, `ON DELETE
  RESTRICT`. A hard delete of a `file_asset` row that has ever been scanned will be refused,
  with SQLSTATE `23001` — not `23503` — because PostgreSQL 18 reports a blocked `ON DELETE
  RESTRICT` as `restrict_violation`. Anything written to catch this must name `23001`.
  The refusal is deliberate: the attempt is the only record of what a scanner said about bytes
  that may no longer exist. Soft deletion is unaffected.
- **Deploy ordering is fixed.** This repository's migrations must run before the worker's, or the
  worker's foreign key has nothing to point at. The failure is loud.

The worker's own [database documentation](../../sto-info-file-scan-worker/docs/database.md)
describes that table.

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
| `user`, `user_profile`, `account`, `character` | Soft-deleted immediately on account closure; hard-deleted by cron after `CLOSED_ACCOUNT_RETENTION_DAYS` (validated to be >= `AUDIT_DATA_NUKE_THRESHOLD_DAYS`) |
| `custom_tracking_*` | Soft-deleted immediately; hard-deleted after **180 days** by `CustomTrackingCleanupService`, except options still referenced by a retained value, which the `ON DELETE RESTRICT` foreign key protects for as long as the reference lasts. Purged in full, ahead of the user row, when a closed account is erased |
| `custom_tracking_image_cleanup` | A queue, not a record: a row exists only between a Cloudflare picture losing its last reference and Cloudflare confirming the deletion. Drained nightly and after every change that orphans a picture |

The Custom Tracking window is a constant rather than an environment variable,
unlike every other row above. It is published — the content agreement and the
Privacy Policy both state 180 days — so it is part of what a member agreed to
rather than part of how a deployment is tuned. A variable would let one
environment quietly keep data longer than the page promised.

The hard deletion runs bottom-up in one statement per table rather than relying
on the cascades. PostgreSQL may process a cascade's branches in any order, and
one of those orders reaches an option while an answer still references it,
which fails the whole job on `FK_custom_tracking_value_option_option`. See
`docs/custom-tracking.md` for the order.

### SES Audit Storage & Ownership

It is important to note that **Amazon SES does not store this audit data long-term.**

1. **Origin**: SES generates events (Bounce, Complaint, Delivery, Reject).
2. **Transit**: Events are pushed immediately via **AWS SNS** to the application's `/webhooks/ses` endpoint.
3. **Storage**: The application processes the event and persists it to the `_audit_ses_event` table in the local PostgreSQL database (storing only HMAC-SHA256 hashes of email addresses).
4. **Retention**: The application's daily maintenance job handles the deletion of these records according to the privacy policy.

For full consistency with the privacy policy, ensure any CloudWatch Log Groups associated with SES reputation metrics are also configured with a retention period of **no more than 180 days** in the AWS Console.

> Note: The `_audit_ses_event` table never stores plaintext email addresses. The `emailHashed` column holds an HMAC-SHA256 digest keyed by `SES_EMAIL_HMAC_SECRET`. See `docs/environment-variables.md` for rotation implications.

**Define project rules here:**

- User account data: retained until deletion is requested, then soft-deleted immediately
- Character/account/profile data: soft-deleted on account closure; hard-deleted after closed-account retention window
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
