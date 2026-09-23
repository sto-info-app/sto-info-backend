import { MigrationInterface, QueryRunner } from 'typeorm';

/** The values the placement state enum held before a placement could wait. */
const PREVIOUS_STATES = [
  'PENDING',
  'ACTIVE',
  'REJECTED',
  'SUPERSEDED',
  'WITHDRAWN',
  'ABANDONED',
];

/** The guard as it stood before, restored by `down`. */
const PREVIOUS_GUARD = `CREATE OR REPLACE FUNCTION "sto_info_app"."file_asset_placement_guard"()
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
      $$ LANGUAGE plpgsql`;

/**
 * Lets a cleared file wait for a decision without being given up on (FC-017).
 *
 * A roster export that claims the same instant as a different export of the
 * same Fleet is scanned like any other, and then has to wait: which of the
 * two is the Fleet's roster at that moment is somebody's decision, not the
 * scanner's. Left `PENDING`, it would be abandoned by the nightly sweep a day
 * later and its bytes deleted, and a decision nobody has made yet is not
 * something a sweep should make by default.
 *
 * So a placement can be `HELD`: the verdict came back, the owning feature
 * read the file, and nothing from it is in force until something releases
 * it. It is settled, as far as the sweep is concerned — it is not waiting for
 * a scanner — so it carries `settledAt` like every other state that is not
 * `PENDING`, and the existing check needs no change.
 *
 * The guard learns one more rule: only a pending placement can be held. A
 * placement that is in force, refused or swept has already been decided, and
 * holding one would be undoing that decision by a side door.
 *
 * It adds no uniqueness rule. Every held placement so far is a roster
 * import's, and every roster import is its own subject, so there is never a
 * second one for the same slot to rule out.
 */
export class HoldFileAssetPlacements1793800000000 implements MigrationInterface {
  /**
   * Adds the state and teaches the guard about it.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."file_asset_placement_state_enum" ADD VALUE IF NOT EXISTS 'HELD'`,
    );

    // The new value is compared as text inside the function body, which is
    // not planned until the trigger first fires, so it may be defined in the
    // same transaction that adds the value.
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

        IF NEW."state"::text = 'HELD' AND OLD."state"::text NOT IN ('PENDING', 'HELD') THEN
          RAISE EXCEPTION 'file_asset_placement cannot be held from %', OLD."state" USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
  }

  /**
   * Restores the guard and narrows the enum.
   *
   * Fails while any placement is held, which is the honest outcome: nothing
   * this could turn a held import into would be true of it.
   *
   * The two partial indexes and the settled check compare the column against
   * a literal of the old type, so they are dropped before the type changes
   * and recreated after it rather than left for PostgreSQL to convert.
   *
   * @param queryRunner - Supplied by TypeORM.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = `"sto_info_app"."file_asset_placement"`;
    const type = `"sto_info_app"."file_asset_placement_state_enum"`;
    const list = PREVIOUS_STATES.map(value => `'${value}'`).join(', ');

    await queryRunner.query(PREVIOUS_GUARD);

    await queryRunner.query(
      `ALTER TABLE ${table} DROP CONSTRAINT "CHK_file_asset_placement_settled"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_file_asset_placement_pending"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_file_asset_placement_active"`,
    );

    await queryRunner.query(
      `ALTER TYPE ${type} RENAME TO "file_asset_placement_state_enum_old"`,
    );
    await queryRunner.query(`CREATE TYPE ${type} AS ENUM (${list})`);
    await queryRunner.query(
      `ALTER TABLE ${table} ALTER COLUMN "state" TYPE ${type} USING "state"::text::${type}`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."file_asset_placement_state_enum_old"`,
    );

    await queryRunner.query(
      `ALTER TABLE ${table} ADD CONSTRAINT "CHK_file_asset_placement_settled" CHECK (("state" = 'PENDING') = ("settledAt" IS NULL))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_file_asset_placement_pending" ON ${table} ("subject", "subjectId", "slot") WHERE "state" = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_file_asset_placement_active" ON ${table} ("subject", "subjectId", "slot") WHERE "state" = 'ACTIVE'`,
    );
  }
}
