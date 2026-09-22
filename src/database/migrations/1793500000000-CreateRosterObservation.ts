import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the roster observation table (FC-017).
 *
 * One row per roster row per import: what one export said about one member
 * on one day. The provenance record says a file arrived and what it hashed
 * to; this is what the file *said*, and it is the thing every report, every
 * membership history and every rename candidate in W04 is eventually read
 * from.
 *
 * ## An observation is not a member
 *
 * Nothing here is a statement about who somebody is. A row records a
 * Character name and an account handle as one export wrote them, on one
 * date, and two rows agreeing are two observations rather than one person —
 * FC-018 builds identity on top of these, reversibly, from evidence. That
 * separation is why this table has no link to a user, no Character
 * identifier and no merge of any kind: an observation that had already
 * decided who it was about could not be revisited when the decision turned
 * out to be wrong.
 *
 * ## Local text beside every instant
 *
 * The same rule as the export stamp on the provenance row, for the same
 * reason. An export writes `4/1/2023 12:00:00pm` and does not say whose
 * clock that was; the instant is an interpretation through a zone somebody
 * supplied, and a zone supplied wrongly is correctable only while the text
 * it was applied to still exists. Each of the four date columns therefore
 * keeps three things: the local text as written, the instant it was read as,
 * and whether that instant was one of two.
 *
 * Twice a year a local time has no single reading. A time the clock skipped
 * is refused where it is read, so no row here carries one. A time the clock
 * repeated names two instants an hour apart, and the earlier is recorded
 * with `…Ambiguous` set rather than the choice being hidden — plan section
 * 3.4.
 *
 * ## Effectiveness is not a column here
 *
 * Whether an import counts is decided by its asset placement, not by a flag
 * on ninety-three rows. `file_asset_placement` already models
 * accepted-not-yet-in-force as `PENDING` and in-force as `ACTIVE`, and each
 * import is placed under its own identifier, so its placement answers for it
 * alone. Adding a second answer here would be a second thing to keep in
 * step.
 *
 * ## Write-once, with the same exception
 *
 * `roster_observation_guard` freezes everything observed: the import, the
 * Fleet, the line, the names, the level, the class, the rank, the
 * contribution, the status, the comment and every local date text. It
 * deliberately leaves the resolved instants and their ambiguity flags
 * mutable, because correcting an export's timezone means re-reading every
 * date it was applied to, and a column a trigger refuses to change cannot be
 * corrected by anything.
 *
 * Both foreign keys are `ON DELETE CASCADE`. An observation exists only as
 * part of an import of a Fleet; neither parent can be removed while it is
 * meaningful, and where one is removed deliberately, leaving orphaned
 * roster rows behind would be worse than removing them.
 */
export class CreateRosterObservation1793500000000 implements MigrationInterface {
  name = 'CreateRosterObservation1793500000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."roster_profession_enum" AS ENUM ('TACTICAL', 'ENGINEERING', 'SCIENCE')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_observation" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "importSourceId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "line" int NOT NULL,
      "characterName" varchar(255) NOT NULL,
      "characterNameNormalised" varchar(255) NOT NULL,
      "accountHandle" varchar(255) NOT NULL,
      "accountHandleNormalised" varchar(255) NOT NULL,
      "level" int NOT NULL,
      "className" varchar(255) NOT NULL,
      "profession" "sto_info_app"."roster_profession_enum",
      "guildRank" varchar(255) NOT NULL,
      "contributionTotal" bigint NOT NULL,
      "joinedAtLocal" varchar(19),
      "joinedAt" timestamptz,
      "joinedAtAmbiguous" boolean NOT NULL DEFAULT false,
      "rankChangedAtLocal" varchar(19),
      "rankChangedAt" timestamptz,
      "rankChangedAtAmbiguous" boolean NOT NULL DEFAULT false,
      "lastActiveAtLocal" varchar(19),
      "lastActiveAt" timestamptz,
      "lastActiveAtAmbiguous" boolean NOT NULL DEFAULT false,
      "status" varchar(255) NOT NULL,
      "publicComment" text NOT NULL,
      "publicCommentEditedAtLocal" varchar(19),
      "publicCommentEditedAt" timestamptz,
      "publicCommentEditedAtAmbiguous" boolean NOT NULL DEFAULT false,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_roster_observation" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_roster_observation_line" UNIQUE ("importSourceId", "line"),
      CONSTRAINT "UQ_roster_observation_identity" UNIQUE ("importSourceId", "accountHandleNormalised", "characterNameNormalised"),
      CONSTRAINT "CHK_roster_observation_line" CHECK ("line" >= 2),
      CONSTRAINT "CHK_roster_observation_level" CHECK ("level" >= 1),
      CONSTRAINT "CHK_roster_observation_contribution" CHECK ("contributionTotal" >= 0),
      CONSTRAINT "CHK_roster_observation_character_name" CHECK (length(btrim("characterName")) > 0),
      CONSTRAINT "CHK_roster_observation_account_handle" CHECK (length(btrim("accountHandle")) > 0),
      CONSTRAINT "CHK_roster_observation_joined_pair" CHECK (("joinedAtLocal" IS NULL) = ("joinedAt" IS NULL)),
      CONSTRAINT "CHK_roster_observation_rank_changed_pair" CHECK (("rankChangedAtLocal" IS NULL) = ("rankChangedAt" IS NULL)),
      CONSTRAINT "CHK_roster_observation_last_active_pair" CHECK (("lastActiveAtLocal" IS NULL) = ("lastActiveAt" IS NULL)),
      CONSTRAINT "CHK_roster_observation_comment_edited_pair" CHECK (("publicCommentEditedAtLocal" IS NULL) = ("publicCommentEditedAt" IS NULL)),
      CONSTRAINT "FK_roster_observation_import" FOREIGN KEY ("importSourceId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_observation_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);

    // Reading one import back, in file order, which is what every report and
    // every comparison of two snapshots starts from.
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_observation_import_line" ON "sto_info_app"."fleet_roster_observation" ("importSourceId", "line")`,
    );

    // "What has this Fleet seen of this account", which is the membership
    // history and the starting point for FC-018's rename candidates. Scoped
    // to the Fleet for the same reason the source-hash index is: a lookup
    // across Fleets would answer whether an account appears in somebody
    // else's roster.
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_observation_fleet_account" ON "sto_info_app"."fleet_roster_observation" ("fleetId", "accountHandleNormalised")`,
    );

    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."roster_observation_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."importSourceId" IS DISTINCT FROM OLD."importSourceId"
          OR NEW."fleetId" IS DISTINCT FROM OLD."fleetId"
          OR NEW."line" IS DISTINCT FROM OLD."line"
          OR NEW."characterName" IS DISTINCT FROM OLD."characterName"
          OR NEW."characterNameNormalised" IS DISTINCT FROM OLD."characterNameNormalised"
          OR NEW."accountHandle" IS DISTINCT FROM OLD."accountHandle"
          OR NEW."accountHandleNormalised" IS DISTINCT FROM OLD."accountHandleNormalised"
          OR NEW."level" IS DISTINCT FROM OLD."level"
          OR NEW."className" IS DISTINCT FROM OLD."className"
          OR NEW."profession" IS DISTINCT FROM OLD."profession"
          OR NEW."guildRank" IS DISTINCT FROM OLD."guildRank"
          OR NEW."contributionTotal" IS DISTINCT FROM OLD."contributionTotal"
          OR NEW."joinedAtLocal" IS DISTINCT FROM OLD."joinedAtLocal"
          OR NEW."rankChangedAtLocal" IS DISTINCT FROM OLD."rankChangedAtLocal"
          OR NEW."lastActiveAtLocal" IS DISTINCT FROM OLD."lastActiveAtLocal"
          OR NEW."status" IS DISTINCT FROM OLD."status"
          OR NEW."publicComment" IS DISTINCT FROM OLD."publicComment"
          OR NEW."publicCommentEditedAtLocal" IS DISTINCT FROM OLD."publicCommentEditedAtLocal" THEN
          RAISE EXCEPTION 'fleet_roster_observation is write-once' USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await queryRunner.query(
      `CREATE TRIGGER "TR_roster_observation_guard" BEFORE UPDATE ON "sto_info_app"."fleet_roster_observation" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."roster_observation_guard"()`,
    );
  }

  /**
   * Reverts the migration.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_roster_observation_guard" ON "sto_info_app"."fleet_roster_observation"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."roster_observation_guard"()`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_observation"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_profession_enum"`,
    );
  }
}
