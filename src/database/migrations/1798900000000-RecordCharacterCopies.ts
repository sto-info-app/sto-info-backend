import { MigrationInterface, QueryRunner } from 'typeorm';

/** The table this migration adds. */
export const CHARACTER_COPY_TABLE = `"sto_info_app"."storytime_character_copy"`;

/** The function that keeps the table write-once. */
export const CHARACTER_COPY_GUARD = `"sto_info_app"."storytime_character_copy_guard"`;

/**
 * Records each Character copied from one Story into another (sc-1483).
 *
 * The Security Log's first creator action, and so its own table, not a row in
 * `site_admin_action`, which records what site admins did. Write-once, except
 * that the actor goes when their account does. The Characters and Stories are
 * named by identifier alone, so the record outlives a Character being deleted.
 * The audit clean-up deletes a row after 180 days, as it does the site admin
 * log's. There is no IP address to forget, because none is kept.
 */
export class RecordCharacterCopies1798900000000 implements MigrationInterface {
  name = 'RecordCharacterCopies1798900000000';

  /**
   * Adds the table, its index and its guard.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE ${CHARACTER_COPY_TABLE} (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "actorUserId" uuid,
      "sourceCharacterId" uuid NOT NULL,
      "sourceStoryId" uuid NOT NULL,
      "copyCharacterId" uuid NOT NULL,
      "targetStoryId" uuid NOT NULL,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_storytime_character_copy" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_storytime_character_copy_other_story" CHECK ("sourceStoryId" <> "targetStoryId"),
      CONSTRAINT "FK_storytime_character_copy_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_storytime_character_copy_created" ON ${CHARACTER_COPY_TABLE} ("createdAt")`,
    );
    await queryRunner.query(`CREATE OR REPLACE FUNCTION ${CHARACTER_COPY_GUARD}()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'actorUserId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId')
          OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId") THEN
          RAISE EXCEPTION 'storytime_character_copy is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_storytime_character_copy_guard" BEFORE UPDATE ON ${CHARACTER_COPY_TABLE} FOR EACH ROW EXECUTE FUNCTION ${CHARACTER_COPY_GUARD}()`,
    );
  }

  /**
   * Takes the table and its guard away again.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ${CHARACTER_COPY_TABLE}`);
    await queryRunner.query(`DROP FUNCTION ${CHARACTER_COPY_GUARD}()`);
  }
}
