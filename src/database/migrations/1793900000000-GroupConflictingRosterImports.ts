import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records that two exports of one Fleet claim the same moment (FC-017).
 *
 * An export's instant is read from its filename, and the filename is the
 * only evidence of it. Two different files claiming the same instant for the
 * same Fleet cannot both be the roster at that moment, and nothing in either
 * file says which is right: an edited export, a clock set wrongly, two
 * officers exporting a second apart and one renaming theirs. Which one
 * stands is somebody's decision.
 *
 * ## A group, not a flag
 *
 * `fleet_roster_import_conflict` is one row per disagreement, and each
 * import in it points at it. A flag on each import would say that something
 * is wrong and not with what; a group says which imports disagree, when the
 * disagreement was found, and whether it has been settled. It is also where
 * the settling will be recorded, which is not built yet and is why there is
 * no resolution column: what a resolution holds is that ticket's decision.
 *
 * At most one open group per Fleet and instant, by a partial unique index.
 * A third import claiming the same instant joins the group already open
 * rather than starting a second one for the same question.
 *
 * ## Same contents are not a conflict
 *
 * Two uploads whose sanitised bytes are the same say the same thing, even if
 * their officer notes differed and so their received bytes did not. They are
 * put in the group when a different one arrives, because they are part of
 * what was said about that moment, but on their own they are not one.
 */
export class GroupConflictingRosterImports1793900000000 implements MigrationInterface {
  /**
   * Creates the group table and points imports at it.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_import_conflict" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fleetId" uuid NOT NULL,
      "exportedAt" timestamptz NOT NULL,
      "openedAt" timestamptz NOT NULL DEFAULT now(),
      "resolvedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_roster_import_conflict" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_roster_import_conflict_resolved" CHECK ("resolvedAt" IS NULL OR "resolvedAt" >= "openedAt"),
      CONSTRAINT "FK_roster_import_conflict_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_roster_import_conflict_open" ON "sto_info_app"."fleet_roster_import_conflict" ("fleetId", "exportedAt") WHERE "resolvedAt" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" ADD "conflictGroupId" uuid`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source"
        ADD CONSTRAINT "FK_roster_import_source_conflict"
        FOREIGN KEY ("conflictGroupId")
        REFERENCES "sto_info_app"."fleet_roster_import_conflict"("id")
        ON DELETE RESTRICT`,
    );

    // Publication asks which imports share a group, to find the one that
    // was there first.
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_import_source_conflict" ON "sto_info_app"."fleet_roster_import_source" ("conflictGroupId")`,
    );
  }

  /**
   * Removes the groups and every import's pointer to one.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_roster_import_source_conflict"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" DROP CONSTRAINT "FK_roster_import_source_conflict"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" DROP COLUMN "conflictGroupId"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_import_conflict"`,
    );
  }
}
