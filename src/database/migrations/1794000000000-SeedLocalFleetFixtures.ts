import { MigrationInterface, QueryRunner } from 'typeorm';

/** The seeded Community, fixed so `down()` removes exactly what `up()` made. */
export const LOCAL_FIXTURE_COMMUNITY_ID =
  '584d8c92-3ce6-4ca8-ba76-320e19bc0225';

/** The seeded Windows Fleet, named as the roster fixtures name it. */
export const LOCAL_FIXTURE_PC_FLEET_ID = '8038747f-fcc3-41b4-b37e-83569c8800a3';

/** The seeded PlayStation Fleet, on a platform that writes no export. */
export const LOCAL_FIXTURE_CONSOLE_FLEET_ID =
  '48ad1eff-0311-45aa-908b-c85bc8265ec3';

/** The master switch the seed turns on, and `down()` turns off. */
const FLEET_SWITCH_KEY = 'FLEET_COMMUNITIES_ENABLED';

/** Every Fleet in the seeded Community, whoever made it. */
const COMMUNITY_FLEETS = `SELECT "id" FROM "sto_info_app"."sto_fleet" WHERE "communityId" = $1`;

/** Every file held by the seeded Community, its Fleets or its Armadas. */
const COMMUNITY_ASSETS = `
  SELECT "id" FROM "sto_info_app"."file_asset"
   WHERE "communityId" = $1
      OR "fleetId" IN (${COMMUNITY_FLEETS})
      OR "armadaId" IN (SELECT "id" FROM "sto_info_app"."sto_armada" WHERE "communityId" = $1)`;

/**
 * Gives a local database a Community and two Fleets to import rosters into.
 *
 * Local only. Nothing happens unless `NODE_ENV` is `local`, so the same
 * migration list can run everywhere and no other environment ever holds
 * these rows.
 *
 * The owner is whoever `DATASEED_FLEET_OWNER_EMAIL` names, looked up rather
 * than written here, because this repository is public and the address is a
 * person's. Without the variable, or without an account answering to it, the
 * seed does nothing: it is a convenience, and a database without it still
 * works.
 *
 * - **Fixture Community**, owned by that account. The owner holds every
 *   capability, `roster.import` and `roster.investigate` among them, without
 *   a role row.
 * - **Fixture Basic Fleet** on Windows. The name is the one the roster
 *   fixtures in `test/fixtures/fleet-community` carry, so an export of it is
 *   read as this Fleet's.
 * - **Fixture Console Fleet** on PlayStation, where the game writes no
 *   export, so the import actions can be seen not to appear.
 *
 * It also turns the Fleet Community switch on, since the rows are no use
 * with the feature off.
 *
 * `down()` removes the Community and everything hanging off it, including
 * Fleets made through the site after seeding and any roster imported into
 * them, then turns the switch back off. The scanner's attempts on those files
 * go too: its table holds the files in place.
 */
export class SeedLocalFleetFixtures1794000000000 implements MigrationInterface {
  name = 'SeedLocalFleetFixtures1794000000000';

  /**
   * Seeds the Community and its Fleets for the named account.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!isLocal()) {
      return;
    }

    const email = process.env.DATASEED_FLEET_OWNER_EMAIL?.trim();

    if (!email) {
      return;
    }

    const owners: Array<{ id: string }> = await queryRunner.query(
      `SELECT "id" FROM "sto_info_app"."user"
        WHERE lower("email") = lower($1) AND "deletedAt" IS NULL`,
      [email],
    );

    if (owners.length === 0) {
      return;
    }

    await queryRunner.query(
      `INSERT INTO "sto_info_app"."fleet_community"
         ("id", "ownerUserId", "name", "slug")
       VALUES ($1, $2, 'Fixture Community', 'fixture-community')
       ON CONFLICT ("id") DO NOTHING`,
      [LOCAL_FIXTURE_COMMUNITY_ID, owners[0].id],
    );

    await this.seedFleet(
      queryRunner,
      LOCAL_FIXTURE_PC_FLEET_ID,
      'Windows',
      'Fixture Basic Fleet',
      'fixture-basic-fleet',
    );

    await this.seedFleet(
      queryRunner,
      LOCAL_FIXTURE_CONSOLE_FLEET_ID,
      'PlayStation',
      'Fixture Console Fleet',
      'fixture-console-fleet',
    );

    await queryRunner.query(
      `UPDATE "sto_info_app"."app_setting" SET "value" = 'true' WHERE "key" = $1`,
      [FLEET_SWITCH_KEY],
    );
  }

  /**
   * Removes the Community and everything hanging off it.
   *
   * The order is the foreign keys' order: most of them restrict, so each
   * row goes before whatever it points at.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!isLocal()) {
      return;
    }

    const community = [LOCAL_FIXTURE_COMMUNITY_ID];

    await queryRunner.query(
      `DELETE FROM "sto_info_app"."character_fleet_membership" WHERE "fleetId" IN (${COMMUNITY_FLEETS})`,
      community,
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."character_fleet_proposal" WHERE "fleetId" IN (${COMMUNITY_FLEETS})`,
      community,
    );

    // Observations cascade with the import they came from.
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."fleet_roster_import_source" WHERE "fleetId" IN (${COMMUNITY_FLEETS})`,
      community,
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."fleet_roster_import_conflict" WHERE "fleetId" IN (${COMMUNITY_FLEETS})`,
      community,
    );

    await queryRunner.query(
      `DELETE FROM "sto_info_app"."file_asset_placement" WHERE "assetId" IN (${COMMUNITY_ASSETS})`,
      community,
    );

    // The worker's schema is its own, and a database it has never migrated
    // has no attempts to remove.
    const [{ scanAttempts }]: Array<{ scanAttempts: string | null }> =
      await queryRunner.query(
        `SELECT to_regclass('sto_info_worker.file_scan_attempt')::text AS "scanAttempts"`,
      );

    if (scanAttempts !== null) {
      await queryRunner.query(
        `DELETE FROM "sto_info_worker"."file_scan_attempt" WHERE "assetId" IN (${COMMUNITY_ASSETS})`,
        community,
      );
    }

    await queryRunner.query(
      `DELETE FROM "sto_info_app"."file_asset" WHERE "id" IN (${COMMUNITY_ASSETS})`,
      community,
    );

    // A retired slug remembers what it pointed at, not who owned it, so it
    // is found by target rather than cascading with the Community.
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."fleet_slug_history"
        WHERE "targetId" = $1 OR "targetId" IN (${COMMUNITY_FLEETS})`,
      community,
    );

    // Aliases, grants, memberships and role assignments cascade.
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."sto_fleet" WHERE "communityId" = $1`,
      community,
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."fleet_community" WHERE "id" = $1`,
      community,
    );

    await queryRunner.query(
      `UPDATE "sto_info_app"."app_setting" SET "value" = 'false' WHERE "key" = $1`,
      [FLEET_SWITCH_KEY],
    );
  }

  /**
   * Seeds one Fleet in the Community, on a platform found by name.
   *
   * Platform identifiers are generated per database, so the name is the
   * only thing every local database agrees on.
   *
   * @param queryRunner - Supplied by TypeORM.
   * @param id - The Fleet's fixed identifier.
   * @param platformName - The platform, as `platform.name` holds it.
   * @param exactGameName - The Fleet's name, exactly as the game writes it.
   * @param slug - Its address within the Community and platform.
   */
  private async seedFleet(
    queryRunner: QueryRunner,
    id: string,
    platformName: string,
    exactGameName: string,
    slug: string,
  ): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "sto_info_app"."sto_fleet"
         ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug")
       SELECT $1, $2, "id", $3, $4, $5
         FROM "sto_info_app"."platform"
        WHERE "name" = $6 AND "deletedAt" IS NULL
       ON CONFLICT ("id") DO NOTHING`,
      [
        id,
        LOCAL_FIXTURE_COMMUNITY_ID,
        exactGameName,
        exactGameName.normalize('NFC').toLowerCase(),
        slug,
        platformName,
      ],
    );
  }
}

/**
 * Whether this is a developer's own database.
 *
 * @returns True only when `NODE_ENV` is `local`.
 */
function isLocal(): boolean {
  return process.env.NODE_ENV?.trim().toLowerCase() === 'local';
}
