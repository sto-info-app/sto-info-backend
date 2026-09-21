import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Caps how many live Fleet Communities one account may own (FC-013, ADR-0022).
 *
 * R03 says "one persistent umbrella" and the schema FC-004 shipped permits any
 * number. Neither is what was decided: the limit is ten, so a player may keep a
 * PC Community and a console one apart, or an Armada's umbrella away from a
 * personal one, while one account still cannot mint unlimited directory
 * entries.
 *
 * **Why a trigger rather than a service check.** A count is a read-then-write,
 * and two concurrent creates both pass one. This is the same argument FC-004
 * made for the partial unique indexes, and it has the same answer: the
 * eleventh Community has to fail loudly rather than appear.
 *
 * **Why the advisory lock.** A trigger counting rows is still racy on its own —
 * two transactions can each count ten and each insert, because neither sees the
 * other's uncommitted row. The lock is taken on the owner, not the table, so
 * two people registering at the same moment never wait for each other; only one
 * account's own concurrent creates serialise, and only until commit.
 *
 * **What counts.** Live rows: `deletedAt IS NULL`. A closed Community still
 * holds its slug and its directory entry, so it still occupies one of the ten.
 * Soft-deleting frees a place, which is the same rule the slug indexes use.
 *
 * The figure is `MAX_FLEET_COMMUNITIES_PER_OWNER` in
 * `src/fleet/constants/fleet-policy.constants.ts`, and its spec reads this file
 * to prove the two have not drifted apart.
 */
export class LimitFleetCommunitiesPerOwner1792800000000 implements MigrationInterface {
  name = 'LimitFleetCommunitiesPerOwner1792800000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."fleet_community_owner_limit"()
      RETURNS trigger AS $$
      DECLARE
        live_count integer;
      BEGIN
        PERFORM pg_advisory_xact_lock(
          hashtext('fleet_community_owner:' || NEW."ownerUserId"::text)
        );

        SELECT count(*) INTO live_count
        FROM "sto_info_app"."fleet_community"
        WHERE "ownerUserId" = NEW."ownerUserId"
          AND "deletedAt" IS NULL
          AND "id" <> NEW."id";

        IF live_count >= 10 THEN
          RAISE EXCEPTION 'a user may own at most 10 live Fleet Communities' USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    // Fires on update as well as insert, because ownership transfer and
    // restoring a soft-deleted Community both add one to somebody's count
    // without inserting anything. A row excludes itself from the count, so an
    // ordinary edit to an account already holding ten still succeeds.
    await queryRunner.query(
      `CREATE TRIGGER "TR_fleet_community_owner_limit" BEFORE INSERT OR UPDATE ON "sto_info_app"."fleet_community" FOR EACH ROW WHEN (NEW."deletedAt" IS NULL) EXECUTE FUNCTION "sto_info_app"."fleet_community_owner_limit"()`,
    );
  }

  /**
   * Reverts the migration.
   *
   * Dropping the trigger leaves any existing rows alone. Nothing here created
   * data, so there is nothing to put back.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_fleet_community_owner_limit" ON "sto_info_app"."fleet_community"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."fleet_community_owner_limit"()`,
    );
  }
}
