import { MigrationInterface, QueryRunner } from 'typeorm';

/** One track of a holding: its own, or one of its departments. */
interface SeedTrack {
  readonly code: string;
  readonly name: string;
  readonly isDepartment: boolean;
  readonly maxTier: number;
}

/** One holding, as the STO Wiki describes it. */
interface SeedHolding {
  readonly code: string;
  readonly name: string;
  readonly sourceUrl: string;
  /** The day the wiki page was last edited when it was read. */
  readonly sourceEditedOn: string;
  readonly tracks: readonly SeedTrack[];
}

/**
 * Builds a holding's tracks: its own first, then its departments, which
 * share its tier range.
 *
 * @param code - The holding's code, which its own track shares.
 * @param name - Its own track's name.
 * @param maxTier - Its highest tier.
 * @param departments - Its departments' names, in the wiki's order.
 * @returns The tracks.
 */
function tracks(
  code: string,
  name: string,
  maxTier: number,
  departments: readonly string[],
): SeedTrack[] {
  return [
    { code, name, isDepartment: false, maxTier },
    ...departments.map(department => ({
      code: `${code}_${department.toUpperCase().replaceAll(' ', '_')}`,
      name: department,
      isDepartment: true,
      maxTier,
    })),
  ];
}

/**
 * The catalogue this migration seeds: version 1, read from the STO Wiki on
 * 28 September 2026. Seven holdings, each with a track of its own and two or
 * three departments; every track fully upgraded makes the Fleet level 85.
 */
const HOLDINGS: readonly SeedHolding[] = [
  {
    code: 'STARBASE',
    name: 'Fleet Starbase',
    sourceUrl: 'https://stowiki.net/wiki/Fleet_Starbase',
    sourceEditedOn: '2026-07-05',
    tracks: tracks('STARBASE', 'Starbase', 5, [
      'Military',
      'Engineering',
      'Science',
    ]),
  },
  {
    code: 'EMBASSY',
    name: 'Fleet Embassy',
    sourceUrl: 'https://stowiki.net/wiki/Fleet_Embassy',
    sourceEditedOn: '2024-08-29',
    tracks: tracks('EMBASSY', 'Embassy', 3, ['Diplomacy', 'Recruitment']),
  },
  {
    code: 'DILITHIUM_MINE',
    name: 'Fleet Dilithium Mine',
    sourceUrl: 'https://stowiki.net/wiki/Fleet_Dilithium_Mine',
    sourceEditedOn: '2022-10-13',
    tracks: tracks('DILITHIUM_MINE', 'Dilithium Mine', 3, [
      'Trade',
      'Development',
    ]),
  },
  {
    code: 'SPIRE',
    name: 'Fleet Spire',
    sourceUrl: 'https://stowiki.net/wiki/Fleet_Spire',
    sourceEditedOn: '2024-08-29',
    tracks: tracks('SPIRE', 'Spire', 3, ['Research', 'Operations']),
  },
  {
    code: 'RESEARCH_LAB',
    name: 'Fleet Research Lab',
    sourceUrl: 'https://stowiki.net/wiki/Fleet_Research_Lab',
    sourceEditedOn: '2024-11-15',
    tracks: tracks('RESEARCH_LAB', 'Research Lab', 3, [
      'Research',
      'Development',
    ]),
  },
  {
    code: 'K13',
    name: 'Deep Space K-13',
    sourceUrl: 'https://stowiki.net/wiki/Deep_Space_K-13',
    sourceEditedOn: '2025-03-04',
    tracks: tracks('K13', 'K-13', 3, [
      'Retrofit Engineering',
      'Xenotech Research',
    ]),
  },
  {
    code: 'COLONY_WORLD',
    name: 'Fleet Colony World',
    sourceUrl: 'https://stowiki.net/wiki/Fleet_Colony_World',
    sourceEditedOn: '2026-08-01',
    tracks: tracks('COLONY_WORLD', 'Colony World', 5, [
      'Morale',
      'Infrastructure',
      'Renewable Energy',
    ]),
  },
];

/** The catalogue version this migration seeds. */
const CATALOGUE_VERSION = 1;

/**
 * Quotes a string for SQL.
 *
 * @param value - The string, which comes from this file alone.
 * @returns It as a SQL literal.
 */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Records the tiers of a Fleet's holdings, by hand, with their history
 * (FC-023).
 *
 * With the decisions Steve made on 28 September 2026:
 *
 * - `fleet_holding_type`, `fleet_holding_track` and `fleet_holding_tier` are
 *   the reference catalogue: each holding, its own track and its
 *   departments, and every tier each track may be at. A recorded tier
 *   references `fleet_holding_tier`, so an invalid tier or a track of
 *   another holding is refused by the database, not only by the service.
 *   Each holding keeps the wiki page it was read from, the day that page
 *   was last edited, and the catalogue version that last changed it. Any
 *   later change to the catalogue is a reviewed migration like this one.
 * - `fleet_holding_status` is where each track of each Fleet stands now. A
 *   track with no row is at tier 0, and nothing is recorded for it.
 * - `fleet_holding_change` is one save of one holding, by whom and why, and
 *   `fleet_holding_history` the tracks it moved, from what to what. Tiers
 *   may go down as well as up, and a reason is optional either way. Both
 *   are append-only; the one change either accepts is the recorder's
 *   account being deleted.
 *
 * There is no XP and nothing derived from contributions.
 */
export class CreateFleetHoldings1795400000000 implements MigrationInterface {
  name = 'CreateFleetHoldings1795400000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_holding_type" (
      "code" varchar(40) NOT NULL,
      "name" varchar(100) NOT NULL,
      "position" smallint NOT NULL,
      "sourceUrl" varchar(300) NOT NULL,
      "sourceEditedOn" date NOT NULL,
      "catalogueVersion" smallint NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_fleet_holding_type" PRIMARY KEY ("code"),
      CONSTRAINT "UQ_fleet_holding_type_position" UNIQUE ("position"),
      CONSTRAINT "CHK_fleet_holding_type_catalogue_version" CHECK ("catalogueVersion" > 0))`);

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_holding_track" (
      "code" varchar(60) NOT NULL,
      "holdingTypeCode" varchar(40) NOT NULL,
      "name" varchar(100) NOT NULL,
      "isDepartment" boolean NOT NULL,
      "position" smallint NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_fleet_holding_track" PRIMARY KEY ("code"),
      CONSTRAINT "UQ_fleet_holding_track_holding" UNIQUE ("holdingTypeCode", "code"),
      CONSTRAINT "UQ_fleet_holding_track_position" UNIQUE ("holdingTypeCode", "position"),
      CONSTRAINT "FK_fleet_holding_track_holding" FOREIGN KEY ("holdingTypeCode") REFERENCES "sto_info_app"."fleet_holding_type"("code") ON DELETE RESTRICT ON UPDATE NO ACTION)`);
    // A holding has exactly one track of its own; the rest are departments.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_fleet_holding_track_own" ON "sto_info_app"."fleet_holding_track" ("holdingTypeCode") WHERE NOT "isDepartment"`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_holding_tier" (
      "trackCode" varchar(60) NOT NULL,
      "tier" smallint NOT NULL,
      CONSTRAINT "PK_fleet_holding_tier" PRIMARY KEY ("trackCode", "tier"),
      CONSTRAINT "CHK_fleet_holding_tier_bounds" CHECK ("tier" >= 0),
      CONSTRAINT "FK_fleet_holding_tier_track" FOREIGN KEY ("trackCode") REFERENCES "sto_info_app"."fleet_holding_track"("code") ON DELETE RESTRICT ON UPDATE NO ACTION)`);

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_holding_status" (
      "fleetId" uuid NOT NULL,
      "communityId" uuid NOT NULL,
      "holdingTypeCode" varchar(40) NOT NULL,
      "trackCode" varchar(60) NOT NULL,
      "tier" smallint NOT NULL,
      "updatedAt" timestamptz NOT NULL,
      CONSTRAINT "PK_fleet_holding_status" PRIMARY KEY ("fleetId", "trackCode"),
      CONSTRAINT "FK_fleet_holding_status_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_holding_status_track" FOREIGN KEY ("holdingTypeCode", "trackCode") REFERENCES "sto_info_app"."fleet_holding_track"("holdingTypeCode", "code") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_holding_status_tier" FOREIGN KEY ("trackCode", "tier") REFERENCES "sto_info_app"."fleet_holding_tier"("trackCode", "tier") ON DELETE RESTRICT ON UPDATE NO ACTION)`);

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_holding_change" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fleetId" uuid NOT NULL,
      "communityId" uuid NOT NULL,
      "holdingTypeCode" varchar(40) NOT NULL,
      "actorUserId" uuid,
      "reason" varchar(500),
      "createdAt" timestamptz NOT NULL,
      CONSTRAINT "PK_fleet_holding_change" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_fleet_holding_change_scope" UNIQUE ("id", "fleetId", "holdingTypeCode"),
      CONSTRAINT "CHK_fleet_holding_change_reason" CHECK ("reason" IS NULL OR length(btrim("reason")) > 0),
      CONSTRAINT "FK_fleet_holding_change_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_holding_change_holding" FOREIGN KEY ("holdingTypeCode") REFERENCES "sto_info_app"."fleet_holding_type"("code") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_holding_change_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_holding_change_fleet" ON "sto_info_app"."fleet_holding_change" ("fleetId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_holding_change_actor" ON "sto_info_app"."fleet_holding_change" ("actorUserId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_holding_history" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "changeId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "holdingTypeCode" varchar(40) NOT NULL,
      "trackCode" varchar(60) NOT NULL,
      "tierBefore" smallint NOT NULL,
      "tier" smallint NOT NULL,
      CONSTRAINT "PK_fleet_holding_history" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_fleet_holding_history_track" UNIQUE ("changeId", "trackCode"),
      CONSTRAINT "CHK_fleet_holding_history_moved" CHECK ("tier" <> "tierBefore"),
      CONSTRAINT "FK_fleet_holding_history_change" FOREIGN KEY ("changeId", "fleetId", "holdingTypeCode") REFERENCES "sto_info_app"."fleet_holding_change"("id", "fleetId", "holdingTypeCode") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_holding_history_track" FOREIGN KEY ("holdingTypeCode", "trackCode") REFERENCES "sto_info_app"."fleet_holding_track"("holdingTypeCode", "code") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_holding_history_tier_before" FOREIGN KEY ("trackCode", "tierBefore") REFERENCES "sto_info_app"."fleet_holding_tier"("trackCode", "tier") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_holding_history_tier" FOREIGN KEY ("trackCode", "tier") REFERENCES "sto_info_app"."fleet_holding_tier"("trackCode", "tier") ON DELETE RESTRICT ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_holding_history_fleet" ON "sto_info_app"."fleet_holding_history" ("fleetId", "trackCode")`,
    );

    // A recorded change is evidence. The one change it accepts is its
    // recorder's account going.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."fleet_holding_change_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'actorUserId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId')
          OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId") THEN
          RAISE EXCEPTION 'fleet_holding_change is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_fleet_holding_change_guard" BEFORE UPDATE ON "sto_info_app"."fleet_holding_change" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."fleet_holding_change_guard"()`,
    );
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."fleet_holding_history_guard"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'fleet_holding_history is write-once' USING ERRCODE = '23514';
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_fleet_holding_history_guard" BEFORE UPDATE ON "sto_info_app"."fleet_holding_history" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."fleet_holding_history_guard"()`,
    );

    await this.seed(queryRunner);
  }

  /**
   * Reverts the migration.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_fleet_holding_history_guard" ON "sto_info_app"."fleet_holding_history"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."fleet_holding_history_guard"()`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_fleet_holding_change_guard" ON "sto_info_app"."fleet_holding_change"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."fleet_holding_change_guard"()`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_holding_history"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."fleet_holding_change"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."fleet_holding_status"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."fleet_holding_tier"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."fleet_holding_track"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."fleet_holding_type"`);
  }

  /**
   * Seeds catalogue version 1.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  private async seed(queryRunner: QueryRunner): Promise<void> {
    const holdings = HOLDINGS.map(
      (holding, index) =>
        `(${literal(holding.code)}, ${literal(holding.name)}, ${index + 1}, ${literal(holding.sourceUrl)}, ${literal(holding.sourceEditedOn)}, ${CATALOGUE_VERSION})`,
    );
    const tracksSql = HOLDINGS.flatMap(holding =>
      holding.tracks.map(
        (track, index) =>
          `(${literal(track.code)}, ${literal(holding.code)}, ${literal(track.name)}, ${track.isDepartment}, ${index + 1})`,
      ),
    );
    const tiers = HOLDINGS.flatMap(holding =>
      holding.tracks.flatMap(track =>
        Array.from(
          { length: track.maxTier + 1 },
          (_, tier) => `(${literal(track.code)}, ${tier})`,
        ),
      ),
    );

    await queryRunner.query(
      `INSERT INTO "sto_info_app"."fleet_holding_type" ("code", "name", "position", "sourceUrl", "sourceEditedOn", "catalogueVersion") VALUES ${holdings.join(', ')}`,
    );
    await queryRunner.query(
      `INSERT INTO "sto_info_app"."fleet_holding_track" ("code", "holdingTypeCode", "name", "isDepartment", "position") VALUES ${tracksSql.join(', ')}`,
    );
    await queryRunner.query(
      `INSERT INTO "sto_info_app"."fleet_holding_tier" ("trackCode", "tier") VALUES ${tiers.join(', ')}`,
    );
  }
}
