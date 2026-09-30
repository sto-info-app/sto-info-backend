import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Keeps who removed a Fleet's former name, and why (FC-050).
 *
 * `fleet_name_alias` has always been matched against roster export
 * filenames, and nothing could write it. FC-050 lets a Fleet's roster
 * investigators record a former name and remove one. Recording already
 * keeps an actor and a reason. Removal is a soft delete, so that an import
 * which matched the name still says which name it matched, and until now a
 * soft delete kept only when. These keep who and why beside it: a name that
 * matched exports and then went is as much evidence as the name itself.
 */
export class RecordFleetFormerNameRemovals1797000000000 implements MigrationInterface {
  /**
   * Adds who removed a former name and why.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_name_alias" ADD COLUMN "removedByUserId" uuid NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_name_alias" ADD COLUMN "removalReason" varchar(500) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_name_alias" ADD CONSTRAINT "FK_fleet_name_alias_removed_by" FOREIGN KEY ("removedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // A removal always says why, and only a removed name has a reason for
    // going. The person may go later, with their account.
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_name_alias" ADD CONSTRAINT "CHK_fleet_name_alias_removal" CHECK (("deletedAt" IS NULL AND "removalReason" IS NULL) OR ("deletedAt" IS NOT NULL AND "removalReason" IS NOT NULL AND length(btrim("removalReason")) > 0))`,
    );
  }

  /**
   * Drops them.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_name_alias" DROP CONSTRAINT "CHK_fleet_name_alias_removal"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_name_alias" DROP CONSTRAINT "FK_fleet_name_alias_removed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_name_alias" DROP COLUMN "removalReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_name_alias" DROP COLUMN "removedByUserId"`,
    );
  }
}
