import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the queue of Cloudflare pictures the site no longer points at.
 *
 * A table rather than a retry inside the request that dropped the reference.
 * A request can end — the process can be recycled mid-deploy — between the row
 * being updated and Cloudflare being told, and there is nothing afterwards
 * that could work out a picture had been left behind: the only record of it
 * was the reference that was just removed.
 *
 * The unique key on the identifier is what makes queueing idempotent. A
 * replacement that is retried, or a sweep that runs twice over the same night,
 * writes the same row rather than a second one to delete twice.
 */
export class CreateCustomTrackingImageCleanupTable1791300000000 implements MigrationInterface {
  name = 'CreateCustomTrackingImageCleanupTable1791300000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."custom_tracking_image_cleanup_reason_enum" AS ENUM ('REPLACED', 'REMOVED', 'RETENTION', 'ACCOUNT_CLOSED', 'ABANDONED_UPLOAD')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."custom_tracking_image_cleanup" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "cloudflareImageId" character varying(160) NOT NULL,
      "reason" "sto_info_app"."custom_tracking_image_cleanup_reason_enum" NOT NULL,
      "attempts" integer NOT NULL DEFAULT 0,
      "lastAttemptedAt" TIMESTAMP,
      "lastError" character varying(300),
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_custom_tracking_image_cleanup" PRIMARY KEY ("id"))`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_custom_tracking_image_cleanup_image" ON "sto_info_app"."custom_tracking_image_cleanup" ("cloudflareImageId")`,
    );

    // The reconciliation pass takes the oldest first, so a picture that has
    // been waiting longest is never starved by a steady arrival of new ones.
    await queryRunner.query(
      `CREATE INDEX "IDX_custom_tracking_image_cleanup_created" ON "sto_info_app"."custom_tracking_image_cleanup" ("createdAt")`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."custom_tracking_image_cleanup"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."custom_tracking_image_cleanup_reason_enum"`,
    );
  }
}
