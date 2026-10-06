import { MigrationInterface, QueryRunner } from 'typeorm';

/** The SQLSTATE a refused platform rename raises. */
export const PLATFORM_RENAME_GUARD_SQLSTATE = 'IRG02';

/** What a refused platform rename says. */
export const PLATFORM_RENAME_REFUSAL =
  'platform.name is part of the address of every Fleet and Armada on that ' +
  'platform, and renaming it would break them all';

/** The tables whose addresses carry a platform's name. */
export const PLATFORM_NAMED_TABLES = [
  'sto_fleet',
  'sto_armada',
  'fleet_slug_history',
] as const;

/**
 * Refuses to rename a platform any Fleet or Armada is on (FC-045).
 *
 * ADR-0022 derives the platform segment of every Fleet and Armada address
 * from `platform.name` rather than a slug column, and accepted that renaming
 * a platform would break every address on it with no redirect, leaving the
 * guard to be written later. Steve chose on 6 October 2026 to close it now.
 *
 * A rename is refused while any Fleet, Armada or old Fleet address — closed
 * ones included, since their addresses still redirect — is on the platform.
 * A platform nothing is on can still be renamed, and nothing else about a
 * platform is guarded.
 */
export class GuardPlatformRenames1797900000000 implements MigrationInterface {
  name = 'GuardPlatformRenames1797900000000';

  /**
   * Adds the guard.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    const inUse = PLATFORM_NAMED_TABLES.map(
      table =>
        `EXISTS (SELECT 1 FROM "sto_info_app"."${table}" WHERE "platformId" = OLD."id")`,
    ).join(' OR ');

    await queryRunner.query(
      `CREATE FUNCTION "sto_info_app"."platform_rename_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW."name" IS DISTINCT FROM OLD."name" AND (${inUse}) THEN
           RAISE EXCEPTION '${PLATFORM_RENAME_REFUSAL}'
             USING ERRCODE = '${PLATFORM_RENAME_GUARD_SQLSTATE}';
         END IF;
         RETURN NEW;
       END $$`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "TR_platform_rename_guard" BEFORE UPDATE OF "name" ON "sto_info_app"."platform" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."platform_rename_guard"()`,
    );
  }

  /**
   * Removes the guard. Nothing else depends on it, so this is safe; renaming
   * a platform is then down to whoever does it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TR_platform_rename_guard" ON "sto_info_app"."platform"`,
    );
    await queryRunner.query(
      `DROP FUNCTION "sto_info_app"."platform_rename_guard"()`,
    );
  }
}
