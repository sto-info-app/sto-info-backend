import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the rebuildable roster projection: membership episodes, changes and
 * interval summaries, each a numbered revision of one Fleet (FC-019).
 *
 * Plan section 4.1 keeps observations as the source of truth and everything
 * derived from them rebuildable, carrying its projection revision, its input
 * imports, its bounds and its known, unknown and reset counts. Nothing here is
 * evidence: dropping every row and replaying the Fleet produces them again.
 *
 * ## Built beside, then published — Steve's decision of 25 September 2026
 *
 * Every derived row carries the `revision` it belongs to. A rebuild writes the
 * next revision's rows beside the published one, then moves the Fleet's
 * `fleet_roster_projection.revision` to it, in the same transaction. A reader
 * reads that number first and pins every query to it, so a report made of
 * several queries never mixes two revisions. The revision before is kept until
 * the next publish, so a report that read the old number just before the
 * switch still finds its rows.
 *
 * ## Asked for, and built
 *
 * `requested` counts the changes that asked for a rebuild, bumped in the same
 * transaction as each change. `built` is the value of `requested` the
 * published revision was built from. A rebuild that finds `built` already at
 * or past `requested` has nothing to do, which is how duplicate and retried
 * jobs cost nothing and a crash mid-build changes nothing; and `requested`
 * ahead of `built` is what a stale projection is.
 *
 * ## Proposals follow the latest export, once
 *
 * Character Fleet proposals are raised after a publish, and only when the
 * latest effective export differs from the one they were last raised from,
 * which `proposedImportId` records once they have been. A crash between the
 * publish and the proposals leaves the two different, and the next replay of
 * the Fleet — even one with nothing to build — raises them then.
 *
 * ## The constraints are the design
 *
 * - **Tenancy is in the keys.** Episodes refer to identities through
 *   `(id, fleetId)`, and changes to their episode through
 *   `(fleetId, revision, identityId, episodeOrdinal)`, so no derived row can
 *   join one Fleet's history to another's, or one revision's to another's.
 * - **A delta is only ever a rise.** `CHK_roster_change_delta` allows a
 *   contribution delta on a CONTRIBUTION_CHANGED row and nowhere else, and
 *   only above zero. A fall is a reset, which carries no delta.
 * - **Nothing is dated more exactly than two exports.** Every change has a
 *   `to` export and, where one exists, a `from` export earlier than it.
 */
export class CreateRosterProjection1794400000000 implements MigrationInterface {
  name = 'CreateRosterProjection1794400000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."roster_projection_input_outcome_enum" AS ENUM ('EFFECTIVE', 'EXCLUDED', 'NOT_SELECTED', 'AWAITING_SELECTION', 'SAME_AS_EFFECTIVE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."roster_episode_start_enum" AS ENUM ('FIRST_SEEN', 'JOINED', 'REJOINED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."roster_episode_end_enum" AS ENUM ('LEFT', 'LEFT_AND_REJOINED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."roster_change_kind_enum" AS ENUM ('JOINED', 'REJOINED', 'LEFT', 'RENAMED', 'RANK_CHANGED', 'JOIN_DATE_CHANGED', 'CONTRIBUTION_CHANGED', 'CONTRIBUTION_RESET')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_projection" (
      "fleetId" uuid NOT NULL,
      "requested" integer NOT NULL DEFAULT 0,
      "built" integer NOT NULL DEFAULT 0,
      "revision" integer NOT NULL DEFAULT 0,
      "publishedAt" timestamptz,
      "latestImportId" uuid,
      "proposedImportId" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_roster_projection" PRIMARY KEY ("fleetId"),
      CONSTRAINT "CHK_roster_projection_counters" CHECK ("built" >= 0 AND "built" <= "requested" AND "revision" >= 0),
      CONSTRAINT "CHK_roster_projection_published" CHECK (("revision" = 0) = ("publishedAt" IS NULL)),
      CONSTRAINT "FK_roster_projection_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_projection_latest" FOREIGN KEY ("latestImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_projection_proposed" FOREIGN KEY ("proposedImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);

    // A sweep finds Fleets whose projection is behind what was asked for.
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_projection_behind" ON "sto_info_app"."fleet_roster_projection" ("fleetId") WHERE "built" < "requested"`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_projection_input" (
      "fleetId" uuid NOT NULL,
      "revision" integer NOT NULL,
      "importSourceId" uuid NOT NULL,
      "exportedAt" timestamptz NOT NULL,
      "outcome" "sto_info_app"."roster_projection_input_outcome_enum" NOT NULL,
      "partial" boolean NOT NULL,
      "excludedRows" integer NOT NULL,
      CONSTRAINT "PK_roster_projection_input" PRIMARY KEY ("fleetId", "revision", "importSourceId"),
      CONSTRAINT "CHK_roster_projection_input_revision" CHECK ("revision" >= 1),
      CONSTRAINT "CHK_roster_projection_input_rows" CHECK ("excludedRows" >= 0),
      CONSTRAINT "FK_roster_projection_input_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_projection_input_import" FOREIGN KEY ("importSourceId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE INDEX "IDX_roster_projection_input_import" ON "sto_info_app"."fleet_roster_projection_input" ("importSourceId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_episode" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fleetId" uuid NOT NULL,
      "revision" integer NOT NULL,
      "identityId" uuid NOT NULL,
      "ordinal" integer NOT NULL,
      "startKind" "sto_info_app"."roster_episode_start_enum" NOT NULL,
      "startedAfterImportId" uuid,
      "startedAfterAt" timestamptz,
      "firstImportId" uuid NOT NULL,
      "firstObservedAt" timestamptz NOT NULL,
      "reportedJoinedAt" timestamptz,
      "reportedJoinedAtAmbiguous" boolean NOT NULL,
      "lastImportId" uuid NOT NULL,
      "lastObservedAt" timestamptz NOT NULL,
      "endKind" "sto_info_app"."roster_episode_end_enum",
      "endedBefore" timestamptz,
      "endedBeforeImportId" uuid,
      "baselineContribution" bigint,
      "lastObservedContribution" bigint,
      CONSTRAINT "PK_roster_episode" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_roster_episode_ordinal" UNIQUE ("fleetId", "revision", "identityId", "ordinal"),
      CONSTRAINT "CHK_roster_episode_revision" CHECK ("revision" >= 1 AND "ordinal" >= 1),
      CONSTRAINT "CHK_roster_episode_started_after" CHECK (("startedAfterImportId" IS NULL) = ("startedAfterAt" IS NULL) AND ("startedAfterAt" IS NULL OR "startedAfterAt" < "firstObservedAt")),
      CONSTRAINT "CHK_roster_episode_observed" CHECK ("firstObservedAt" <= "lastObservedAt"),
      CONSTRAINT "CHK_roster_episode_end" CHECK (("endKind" IS NULL) = ("endedBefore" IS NULL) AND ("endKind" IS NOT DISTINCT FROM 'LEFT') = ("endedBeforeImportId" IS NOT NULL)),
      CONSTRAINT "CHK_roster_episode_contribution" CHECK (("baselineContribution" IS NULL OR "baselineContribution" >= 0) AND ("lastObservedContribution" IS NULL OR "lastObservedContribution" >= 0)),
      CONSTRAINT "FK_roster_episode_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_episode_identity" FOREIGN KEY ("identityId", "fleetId") REFERENCES "sto_info_app"."fleet_roster_identity"("id", "fleetId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_episode_started_after" FOREIGN KEY ("startedAfterImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_episode_first" FOREIGN KEY ("firstImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_episode_last" FOREIGN KEY ("lastImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_episode_ended_before" FOREIGN KEY ("endedBeforeImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);

    // The roster as it stood at a moment: episodes that had begun by then,
    // read from the latest observed end.
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_episode_span" ON "sto_info_app"."fleet_roster_episode" ("fleetId", "revision", "firstObservedAt", "lastObservedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_episode_identity" ON "sto_info_app"."fleet_roster_episode" ("identityId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_change" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fleetId" uuid NOT NULL,
      "revision" integer NOT NULL,
      "identityId" uuid NOT NULL,
      "episodeOrdinal" integer NOT NULL,
      "kind" "sto_info_app"."roster_change_kind_enum" NOT NULL,
      "fromImportId" uuid,
      "fromAt" timestamptz,
      "toImportId" uuid NOT NULL,
      "toAt" timestamptz NOT NULL,
      "acrossGap" boolean NOT NULL,
      "contributionDelta" bigint,
      "detail" jsonb NOT NULL DEFAULT '{}',
      CONSTRAINT "PK_roster_change" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_roster_change_bounds" CHECK (("fromImportId" IS NULL) = ("fromAt" IS NULL) AND ("fromAt" IS NULL OR "fromAt" < "toAt")),
      CONSTRAINT "CHK_roster_change_delta" CHECK (("kind" = 'CONTRIBUTION_CHANGED') = ("contributionDelta" IS NOT NULL) AND ("contributionDelta" IS NULL OR "contributionDelta" > 0)),
      CONSTRAINT "FK_roster_change_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_change_episode" FOREIGN KEY ("fleetId", "revision", "identityId", "episodeOrdinal") REFERENCES "sto_info_app"."fleet_roster_episode"("fleetId", "revision", "identityId", "ordinal") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_change_from" FOREIGN KEY ("fromImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_change_to" FOREIGN KEY ("toImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE INDEX "IDX_roster_change_when" ON "sto_info_app"."fleet_roster_change" ("fleetId", "revision", "toAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_change_identity" ON "sto_info_app"."fleet_roster_change" ("fleetId", "revision", "identityId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_interval_summary" (
      "fleetId" uuid NOT NULL,
      "revision" integer NOT NULL,
      "fromImportId" uuid NOT NULL,
      "fromAt" timestamptz NOT NULL,
      "toImportId" uuid NOT NULL,
      "toAt" timestamptz NOT NULL,
      "partial" boolean NOT NULL,
      "membersAtStart" integer NOT NULL,
      "membersAtEnd" integer NOT NULL,
      "joined" integer NOT NULL,
      "rejoined" integer NOT NULL,
      "left" integer NOT NULL,
      "unknown" integer NOT NULL,
      "renamed" integer NOT NULL,
      "rankChanged" integer NOT NULL,
      "joinDateChanged" integer NOT NULL,
      "acrossGap" integer NOT NULL,
      "contributionDelta" bigint NOT NULL,
      "contributionKnown" integer NOT NULL,
      "contributionReset" integer NOT NULL,
      "contributionBaseline" integer NOT NULL,
      "contributionUnknown" integer NOT NULL,
      CONSTRAINT "PK_roster_interval_summary" PRIMARY KEY ("fleetId", "revision", "fromImportId"),
      CONSTRAINT "UQ_roster_interval_summary_to" UNIQUE ("fleetId", "revision", "toAt"),
      CONSTRAINT "CHK_roster_interval_summary_bounds" CHECK ("revision" >= 1 AND "fromAt" < "toAt"),
      CONSTRAINT "CHK_roster_interval_summary_counts" CHECK (LEAST("membersAtStart", "membersAtEnd", "joined", "rejoined", "left", "unknown", "renamed", "rankChanged", "joinDateChanged", "acrossGap", "contributionKnown", "contributionReset", "contributionBaseline", "contributionUnknown") >= 0 AND "contributionDelta" >= 0),
      CONSTRAINT "FK_roster_interval_summary_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_interval_summary_from" FOREIGN KEY ("fromImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_interval_summary_to" FOREIGN KEY ("toImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
  }

  /**
   * Reverts the migration.
   *
   * Loses nothing that cannot be rebuilt: every row here is derived.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_interval_summary"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."fleet_roster_change"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."fleet_roster_episode"`);
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_projection_input"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_projection"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_change_kind_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_episode_end_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_episode_start_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_projection_input_outcome_enum"`,
    );
  }
}
