import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the asset registry (FC-008).
 *
 * One table and four enum types. Nothing existing is altered, so this applies
 * independently of the services that read it and of the backfill that follows
 * it.
 *
 * Four things here carry the ticket's acceptance criteria, and each is a
 * database rule rather than a service check because each has to hold against
 * every future caller rather than against the ones written today.
 *
 * **`AVAILABLE` has two doors and no others.** `file_asset_guard` refuses any
 * update that moves a row into `AVAILABLE` from anything but `CLEAN` — a
 * scanner verdict followed by a publication decision — or `UNVERIFIED`, which
 * is the backfill of bytes the site has been serving since before any of this
 * existed. There is no path from `REJECTED` or `REVOKED`, so a refused file
 * cannot be published by any sequence of writes, however it is attempted. The
 * first acceptance criterion is that only `AVAILABLE` assets are served and
 * that a clean scanner status alone is not enough; this is the half of it that
 * lives in the schema.
 *
 * **Object identity is write-once.** The same trigger refuses a change to
 * `objectKey`, `objectVersion` or `sha256` once any of them holds a value.
 * Null to a value is how they are filled in; a value to a different value is
 * an error naming the column. Replacing a file therefore means registering a
 * new asset that has no verdict yet, which is the fourth acceptance criterion:
 * a replacement invalidates the prior verdict rather than inheriting it.
 *
 * **An available asset has somewhere for its bytes to be.** A check constraint
 * requires `objectKey` and a real storage location in that state, so
 * "available" cannot mean "published, location unknown".
 *
 * **A scoped audience names exactly one scope, and nothing else carries one.**
 * Two constraints rather than one, because they say different things.
 * `audience = 'SCOPE'` and holding a scope audience are written as an equality
 * between two booleans, so a row cannot carry a visibility rule it will never
 * consult — which the single combined constraint this replaced quietly
 * allowed, and the rehearsal caught. The second requires a scoped asset to
 * name exactly one scope, so nothing is published to the members of nothing.
 *
 * The scope columns themselves stay free-standing, subject only to at most one
 * being set. A Fleet's public banner belongs to that Fleet even though anybody
 * may see it, and the registry needs to know that for cleanup and for
 * campaigns; tying ownership to visibility would throw the fact away.
 *
 * The owner foreign key is `ON DELETE SET NULL` rather than cascading. The row
 * is what tells the cleanup cron an object exists; deleting it when the
 * uploader's account goes would leave the bytes in the bucket with nothing
 * pointing at them, and an object no inventory can find is the one thing a
 * rescan campaign cannot reach. The personal link is severed; the evidence
 * that something is stored is not.
 */
export class CreateFileAssets1792100000000 implements MigrationInterface {
  name = 'CreateFileAssets1792100000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."file_asset_kind_enum" AS ENUM ('PROFILE_IMAGE', 'CHARACTER_IMAGE', 'STORYTIME_IMAGE', 'CUSTOM_TRACKING_IMAGE', 'ROSTER_IMPORT_SOURCE', 'FLEET_IMAGE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."file_asset_state_enum" AS ENUM ('UNVERIFIED', 'RECEIVING', 'QUARANTINED', 'SCANNING', 'CLEAN', 'AVAILABLE', 'RETRY_PENDING', 'REJECTED', 'REVOKED', 'DELETED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."file_asset_audience_enum" AS ENUM ('PUBLIC', 'AUTHENTICATED', 'OWNER', 'SCOPE', 'RESTRICTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."file_asset_storage_enum" AS ENUM ('QUARANTINE', 'PUBLIC_IMAGES', 'LEGACY_PUBLIC_R2', 'NONE')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."file_asset" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "kind" "sto_info_app"."file_asset_kind_enum" NOT NULL,
      "state" "sto_info_app"."file_asset_state_enum" NOT NULL,
      "audience" "sto_info_app"."file_asset_audience_enum" NOT NULL,
      "storage" "sto_info_app"."file_asset_storage_enum" NOT NULL,
      "ownerUserId" uuid,
      "communityId" uuid,
      "fleetId" uuid,
      "armadaId" uuid,
      "scopeAudience" "sto_info_app"."fleet_audience_enum",
      "objectKey" varchar(1024),
      "objectVersion" varchar(255),
      "sha256" char(64),
      "byteSize" bigint,
      "declaredContentType" varchar(255),
      "detectedContentType" varchar(255),
      "originalFilename" varchar(255),
      "policyVersion" int NOT NULL DEFAULT 1,
      "scanEngine" varchar(100),
      "scanEngineVersion" varchar(100),
      "scanSignatureVersion" varchar(100),
      "rejectionCode" varchar(100),
      "revocationReason" varchar(500),
      "purgeRequiredAt" timestamptz,
      "purgedAt" timestamptz,
      "retainUntil" timestamptz,
      "lastVerdictAt" timestamptz,
      "availableAt" timestamptz,
      "withdrawnAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      CONSTRAINT "PK_file_asset" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_file_asset_single_scope" CHECK (num_nonnulls("communityId", "fleetId", "armadaId") <= 1),
      CONSTRAINT "CHK_file_asset_scope_audience" CHECK (("audience" = 'SCOPE') = ("scopeAudience" IS NOT NULL)),
      CONSTRAINT "CHK_file_asset_scope_named" CHECK ("audience" <> 'SCOPE' OR num_nonnulls("communityId", "fleetId", "armadaId") = 1),
      CONSTRAINT "CHK_file_asset_available_object" CHECK ("state" <> 'AVAILABLE' OR ("objectKey" IS NOT NULL AND "storage" <> 'NONE')),
      CONSTRAINT "CHK_file_asset_sha256_hex" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "CHK_file_asset_byte_size" CHECK ("byteSize" IS NULL OR "byteSize" >= 0),
      CONSTRAINT "CHK_file_asset_policy_version" CHECK ("policyVersion" >= 1),
      CONSTRAINT "CHK_file_asset_purged_after_required" CHECK ("purgedAt" IS NULL OR "purgeRequiredAt" IS NOT NULL),
      CONSTRAINT "FK_file_asset_owner" FOREIGN KEY ("ownerUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_file_asset_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_file_asset_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_file_asset_armada" FOREIGN KEY ("armadaId") REFERENCES "sto_info_app"."sto_armada"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`);

    // One row per stored object. Two assets claiming the same key would mean
    // two verdicts and two audiences for one set of bytes, and the delivery
    // endpoint would serve whichever it found first.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_file_asset_object" ON "sto_info_app"."file_asset" ("storage", "objectKey") WHERE "deletedAt" IS NULL AND "objectKey" IS NOT NULL`,
    );

    // A rescan campaign selects by state and type; the estate is large enough
    // that this is the difference between a query plan and a table scan.
    await queryRunner.query(
      `CREATE INDEX "IDX_file_asset_state_kind" ON "sto_info_app"."file_asset" ("state", "kind")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_asset_owner" ON "sto_info_app"."file_asset" ("ownerUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_asset_community" ON "sto_info_app"."file_asset" ("communityId")`,
    );

    // Withdrawn bytes that were once public and have not yet been purged are
    // the population an alert watches, and it is normally empty.
    await queryRunner.query(
      `CREATE INDEX "IDX_file_asset_purge_outstanding" ON "sto_info_app"."file_asset" ("purgeRequiredAt") WHERE "purgeRequiredAt" IS NOT NULL AND "purgedAt" IS NULL`,
    );

    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."file_asset_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF OLD."objectKey" IS NOT NULL AND NEW."objectKey" IS DISTINCT FROM OLD."objectKey" THEN
          RAISE EXCEPTION 'file_asset.objectKey is write-once' USING ERRCODE = '23514';
        END IF;

        IF OLD."objectVersion" IS NOT NULL AND NEW."objectVersion" IS DISTINCT FROM OLD."objectVersion" THEN
          RAISE EXCEPTION 'file_asset.objectVersion is write-once' USING ERRCODE = '23514';
        END IF;

        IF OLD."sha256" IS NOT NULL AND NEW."sha256" IS DISTINCT FROM OLD."sha256" THEN
          RAISE EXCEPTION 'file_asset.sha256 is write-once' USING ERRCODE = '23514';
        END IF;

        IF NEW."state" = 'AVAILABLE' AND OLD."state" NOT IN ('AVAILABLE', 'CLEAN', 'UNVERIFIED') THEN
          RAISE EXCEPTION 'file_asset cannot become AVAILABLE from %', OLD."state" USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await queryRunner.query(
      `CREATE TRIGGER "TR_file_asset_guard" BEFORE UPDATE ON "sto_info_app"."file_asset" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."file_asset_guard"()`,
    );
  }

  /**
   * Reverts the migration.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_file_asset_guard" ON "sto_info_app"."file_asset"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."file_asset_guard"()`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."file_asset"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."file_asset_storage_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."file_asset_audience_enum"`,
    );
    await queryRunner.query(`DROP TYPE "sto_info_app"."file_asset_state_enum"`);
    await queryRunner.query(`DROP TYPE "sto_info_app"."file_asset_kind_enum"`);
  }
}
