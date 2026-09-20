import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates asset placements and the delivery reference (FC-012).
 *
 * Two changes, both in service of one thing: an upload that finishes minutes
 * after the request that started it, in another process, with nothing in hand
 * but an asset identifier.
 *
 * **`file_asset.deliveryReference` says how the object is addressed now.**
 * `objectKey` cannot: it is write-once by design, and for anything this
 * application quarantined it holds the quarantine key the bytes were hashed
 * under. Publishing to Cloudflare Images gives the object a second address,
 * and withdrawing it later means deleting it by that address. Legacy rows get
 * their existing object key copied across, so one column answers "what has to
 * be deleted to withdraw this" for the estate and for everything uploaded
 * since. The unique index is the invariant the lookup rests on: one delivered
 * object, one asset.
 *
 * **`file_asset_placement` says which slot a picture is for.** A Story has a
 * banner and a profile image; a Custom Tracking picture answers a Field for a
 * record. The registry knows neither, and the publisher has to know both.
 *
 * Four rules are the database's rather than the service's.
 *
 * **One pending and one active placement per slot.** Two partial unique
 * indexes. A second upload to a slot supersedes the first rather than racing
 * it, and two rows claiming to be what a slot shows would be two answers to
 * one question.
 *
 * **A pending placement has not settled, and a settled one has.** A check
 * constraint, because `settledAt` is what the nightly sweep measures
 * abandonment against and a pending row carrying one would be invisible to
 * it.
 *
 * **Identity is write-once.** Which asset, which record, which slot: a
 * placement that could be re-pointed would let a rejected upload be quietly
 * turned into an accepted one by an UPDATE.
 *
 * **Nothing returns to pending.** A placement moves out of `PENDING` exactly
 * once. Without it, a swept placement could be revived after its bytes had
 * been dropped.
 */
export class CreateFileAssetPlacements1792600000000 implements MigrationInterface {
  name = 'CreateFileAssetPlacements1792600000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_asset" ADD COLUMN "deliveryReference" varchar(255)`,
    );

    // Everything already on a public route is addressed by the key the
    // backfill wrote, which for a Cloudflare Images object is its identifier.
    // Copying it here rather than teaching every later reader to look in two
    // places depending on how old the row is.
    await queryRunner.query(`
      UPDATE "sto_info_app"."file_asset"
      SET "deliveryReference" = "objectKey"
      WHERE "objectKey" IS NOT NULL
        AND "storage" IN ('PUBLIC_IMAGES', 'LEGACY_PUBLIC_R2')
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_file_asset_delivery_reference" ON "sto_info_app"."file_asset" ("deliveryReference") WHERE "deliveryReference" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."file_asset_placement_state_enum" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN', 'ABANDONED')`,
    );

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."file_asset_subject_enum" AS ENUM ('USER_PROFILE', 'STO_CHARACTER', 'STORYTIME_ARC', 'STORYTIME_STORY', 'STORYTIME_CHAPTER', 'STORYTIME_CAST_MEMBER', 'STORYTIME_SPOTLIGHT', 'CUSTOM_TRACKING_VALUE', 'FLEET_COMMUNITY', 'FLEET', 'ARMADA')`,
    );

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."file_asset_slot_enum" AS ENUM ('PICTURE', 'PORTRAIT', 'BANNER', 'PROFILE', 'COVER', 'OVERRIDE', 'EMBLEM')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."file_asset_placement" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "assetId" uuid NOT NULL,
      "state" "sto_info_app"."file_asset_placement_state_enum" NOT NULL,
      "subject" "sto_info_app"."file_asset_subject_enum" NOT NULL,
      "subjectId" varchar(100) NOT NULL,
      "slot" "sto_info_app"."file_asset_slot_enum" NOT NULL,
      "detail" jsonb,
      "settledAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_file_asset_placement" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_file_asset_placement_subject_id" CHECK (length(btrim("subjectId")) > 0),
      CONSTRAINT "CHK_file_asset_placement_settled" CHECK (("state" = 'PENDING') = ("settledAt" IS NULL)),
      CONSTRAINT "FK_file_asset_placement_asset" FOREIGN KEY ("assetId") REFERENCES "sto_info_app"."file_asset"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_file_asset_placement_pending" ON "sto_info_app"."file_asset_placement" ("subject", "subjectId", "slot") WHERE "state" = 'PENDING'`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_file_asset_placement_active" ON "sto_info_app"."file_asset_placement" ("subject", "subjectId", "slot") WHERE "state" = 'ACTIVE'`,
    );

    // The publication queue arrives holding an asset identifier and asks
    // which slot was waiting for it.
    await queryRunner.query(
      `CREATE INDEX "IDX_file_asset_placement_asset" ON "sto_info_app"."file_asset_placement" ("assetId")`,
    );

    // The nightly sweep asks for pending placements older than its threshold.
    await queryRunner.query(
      `CREATE INDEX "IDX_file_asset_placement_state" ON "sto_info_app"."file_asset_placement" ("state", "createdAt")`,
    );

    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."file_asset_placement_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."assetId" IS DISTINCT FROM OLD."assetId"
          OR NEW."subject" IS DISTINCT FROM OLD."subject"
          OR NEW."subjectId" IS DISTINCT FROM OLD."subjectId"
          OR NEW."slot" IS DISTINCT FROM OLD."slot" THEN
          RAISE EXCEPTION 'file_asset_placement identity is write-once' USING ERRCODE = '23514';
        END IF;

        IF OLD."state" <> 'PENDING' AND NEW."state" = 'PENDING' THEN
          RAISE EXCEPTION 'file_asset_placement cannot return to PENDING from %', OLD."state" USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await queryRunner.query(
      `CREATE TRIGGER "TR_file_asset_placement_guard" BEFORE UPDATE ON "sto_info_app"."file_asset_placement" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."file_asset_placement_guard"()`,
    );
  }

  /**
   * Reverts the migration.
   *
   * Dropping the table takes the placements with it, which is the honest
   * outcome: without them nothing can say which slot an in-flight upload was
   * for, and reverting this is reverting the feature that produced them.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_file_asset_placement_guard" ON "sto_info_app"."file_asset_placement"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."file_asset_placement_guard"()`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."file_asset_placement"`);
    await queryRunner.query(`DROP TYPE "sto_info_app"."file_asset_slot_enum"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."file_asset_subject_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."file_asset_placement_state_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_file_asset_delivery_reference"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_asset" DROP COLUMN "deliveryReference"`,
    );
  }
}
