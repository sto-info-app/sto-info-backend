import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates roster identities, their aliases, rename candidates and the
 * decisions taken on them (FC-018).
 *
 * A roster row names a Character and an account handle, and neither is
 * permanent: both can be renamed in the game, and nothing in an export says
 * when one was. ADR-0002 gives every observed identity a UUID of its own so
 * that a rename can be recorded as two names for one identity rather than as
 * one member leaving and another joining.
 *
 * ## Four tables, and which of them is evidence
 *
 * - `fleet_roster_identity` is the UUID. It needs no STO Info account, which
 *   is how somebody who has never signed up stays a first-class roster entry.
 * - `fleet_roster_identity_alias` is one exact Character name and handle, as
 *   normalised, and says which identity it currently belongs to. Every alias
 *   is born with an identity of its own, kept in `originIdentityId`, so
 *   undoing a merge has somewhere to put the alias back.
 * - `fleet_roster_identity_candidate` is a rename the evidence suggests, with
 *   the signals behind it and where a reviewer has left it.
 * - `fleet_roster_identity_decision` is each thing a reviewer did, append-only.
 *
 * Observations are not touched. The plan put an identity column on each
 * observation; Steve chose on 24 September 2026 to join through the alias
 * key instead, so a decision rewrites a small alias table rather than every
 * row of every export the Fleet has imported.
 *
 * ## The constraints are the design
 *
 * **One alias per exact key and Fleet.** `UX_roster_identity_alias_key`.
 * Recomputing a Fleet's identities finds the alias it made last time rather
 * than making another, which is what keeps identity UUIDs stable across
 * recomputes.
 *
 * **Tenancy is in the keys.** Aliases refer to identities, and candidates and
 * their links to aliases, through `(id, fleetId)` pairs, so no row can join
 * one Fleet's evidence to another's.
 *
 * **A candidate is shaped by its kind.** `CHK_roster_identity_candidate_kind`
 * requires the alias pair for a Character rename and the handle pair for an
 * account rename, and neither for the other. `kind` is `NOT NULL`, so the
 * check cannot pass on a NULL the way a nullable comparison would.
 *
 * **An unresolvable candidate stays open.** A candidate with collision
 * reasons can be seen and not decided, and
 * `CHK_roster_identity_candidate_collision_open` makes that true of the data
 * rather than only of the route.
 *
 * **Decisions are write-once.** `roster_identity_decision_guard` refuses an
 * UPDATE, and `UX_roster_identity_decision_revision` numbers them per
 * candidate so two reviewers acting at once cannot both be the next one.
 */
export class CreateRosterIdentities1794100000000 implements MigrationInterface {
  name = 'CreateRosterIdentities1794100000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."roster_identity_candidate_kind_enum" AS ENUM ('CHARACTER_RENAME', 'ACCOUNT_RENAME')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."roster_identity_candidate_state_enum" AS ENUM ('OPEN', 'CONFIRMED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."roster_identity_confidence_enum" AS ENUM ('HIGH', 'MEDIUM', 'LOW')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."roster_identity_collision_reason_enum" AS ENUM ('SEVERAL_PARTNERS', 'OLD_HANDLE_STILL_PRESENT', 'NEW_HANDLE_ALREADY_PRESENT', 'HANDLE_SPLIT', 'HANDLE_MERGE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."roster_identity_decision_action_enum" AS ENUM ('CONFIRM', 'REJECT', 'UNDO')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_identity" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fleetId" uuid NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_roster_identity" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_roster_identity_tenancy" UNIQUE ("id", "fleetId"),
      CONSTRAINT "FK_roster_identity_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_identity_alias" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fleetId" uuid NOT NULL,
      "identityId" uuid NOT NULL,
      "originIdentityId" uuid NOT NULL,
      "characterName" varchar(255) NOT NULL,
      "characterNameNormalised" varchar(255) NOT NULL,
      "accountHandle" varchar(255) NOT NULL,
      "accountHandleNormalised" varchar(255) NOT NULL,
      "firstObservedAt" timestamptz,
      "lastObservedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_roster_identity_alias" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_roster_identity_alias_tenancy" UNIQUE ("id", "fleetId"),
      CONSTRAINT "UQ_roster_identity_alias_origin" UNIQUE ("originIdentityId"),
      CONSTRAINT "CHK_roster_identity_alias_observed" CHECK (("firstObservedAt" IS NULL AND "lastObservedAt" IS NULL) OR ("firstObservedAt" IS NOT NULL AND "lastObservedAt" IS NOT NULL AND "firstObservedAt" <= "lastObservedAt")),
      CONSTRAINT "FK_roster_identity_alias_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_identity_alias_identity" FOREIGN KEY ("identityId", "fleetId") REFERENCES "sto_info_app"."fleet_roster_identity"("id", "fleetId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_identity_alias_origin" FOREIGN KEY ("originIdentityId", "fleetId") REFERENCES "sto_info_app"."fleet_roster_identity"("id", "fleetId") ON DELETE CASCADE ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_roster_identity_alias_key" ON "sto_info_app"."fleet_roster_identity_alias" ("fleetId", "characterNameNormalised", "accountHandleNormalised")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_identity_alias_identity" ON "sto_info_app"."fleet_roster_identity_alias" ("identityId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_identity_candidate" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fleetId" uuid NOT NULL,
      "kind" "sto_info_app"."roster_identity_candidate_kind_enum" NOT NULL,
      "state" "sto_info_app"."roster_identity_candidate_state_enum" NOT NULL DEFAULT 'OPEN',
      "fromAliasId" uuid,
      "toAliasId" uuid,
      "fromHandleNormalised" varchar(255),
      "toHandleNormalised" varchar(255),
      "earlierImportId" uuid NOT NULL,
      "laterImportId" uuid NOT NULL,
      "confidence" "sto_info_app"."roster_identity_confidence_enum" NOT NULL,
      "signals" jsonb NOT NULL,
      "collisionReasons" "sto_info_app"."roster_identity_collision_reason_enum" array NOT NULL DEFAULT '{}',
      "stale" boolean NOT NULL DEFAULT false,
      "revision" integer NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_roster_identity_candidate" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_roster_identity_candidate_kind" CHECK (("kind" = 'CHARACTER_RENAME' AND "fromAliasId" IS NOT NULL AND "toAliasId" IS NOT NULL AND "fromAliasId" <> "toAliasId" AND "fromHandleNormalised" IS NULL AND "toHandleNormalised" IS NULL) OR ("kind" = 'ACCOUNT_RENAME' AND "fromHandleNormalised" IS NOT NULL AND "toHandleNormalised" IS NOT NULL AND "fromHandleNormalised" <> "toHandleNormalised" AND "fromAliasId" IS NULL AND "toAliasId" IS NULL)),
      CONSTRAINT "CHK_roster_identity_candidate_collision_open" CHECK (cardinality("collisionReasons") = 0 OR "state" = 'OPEN'),
      CONSTRAINT "CHK_roster_identity_candidate_revision" CHECK ("revision" >= 0),
      CONSTRAINT "CHK_roster_identity_candidate_imports" CHECK ("earlierImportId" <> "laterImportId"),
      CONSTRAINT "FK_roster_identity_candidate_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_identity_candidate_from" FOREIGN KEY ("fromAliasId", "fleetId") REFERENCES "sto_info_app"."fleet_roster_identity_alias"("id", "fleetId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_identity_candidate_to" FOREIGN KEY ("toAliasId", "fleetId") REFERENCES "sto_info_app"."fleet_roster_identity_alias"("id", "fleetId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_identity_candidate_earlier" FOREIGN KEY ("earlierImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_identity_candidate_later" FOREIGN KEY ("laterImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_roster_identity_candidate_character" ON "sto_info_app"."fleet_roster_identity_candidate" ("fleetId", "fromAliasId", "toAliasId") WHERE "kind" = 'CHARACTER_RENAME'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_roster_identity_candidate_account" ON "sto_info_app"."fleet_roster_identity_candidate" ("fleetId", "fromHandleNormalised", "toHandleNormalised") WHERE "kind" = 'ACCOUNT_RENAME'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_identity_candidate_fleet_state" ON "sto_info_app"."fleet_roster_identity_candidate" ("fleetId", "state")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_identity_candidate_earlier" ON "sto_info_app"."fleet_roster_identity_candidate" ("earlierImportId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_identity_candidate_later" ON "sto_info_app"."fleet_roster_identity_candidate" ("laterImportId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_identity_candidate_link" (
      "candidateId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "fromAliasId" uuid NOT NULL,
      "toAliasId" uuid NOT NULL,
      CONSTRAINT "PK_roster_identity_candidate_link" PRIMARY KEY ("candidateId", "fromAliasId"),
      CONSTRAINT "UQ_roster_identity_candidate_link_to" UNIQUE ("candidateId", "toAliasId"),
      CONSTRAINT "CHK_roster_identity_candidate_link_pair" CHECK ("fromAliasId" <> "toAliasId"),
      CONSTRAINT "FK_roster_identity_candidate_link_candidate" FOREIGN KEY ("candidateId") REFERENCES "sto_info_app"."fleet_roster_identity_candidate"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_identity_candidate_link_from" FOREIGN KEY ("fromAliasId", "fleetId") REFERENCES "sto_info_app"."fleet_roster_identity_alias"("id", "fleetId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_identity_candidate_link_to" FOREIGN KEY ("toAliasId", "fleetId") REFERENCES "sto_info_app"."fleet_roster_identity_alias"("id", "fleetId") ON DELETE CASCADE ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE INDEX "IDX_roster_identity_candidate_link_from" ON "sto_info_app"."fleet_roster_identity_candidate_link" ("fromAliasId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_identity_candidate_link_to" ON "sto_info_app"."fleet_roster_identity_candidate_link" ("toAliasId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_identity_decision" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "candidateId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "action" "sto_info_app"."roster_identity_decision_action_enum" NOT NULL,
      "fromState" "sto_info_app"."roster_identity_candidate_state_enum" NOT NULL,
      "toState" "sto_info_app"."roster_identity_candidate_state_enum" NOT NULL,
      "revision" integer NOT NULL,
      "actorUserId" uuid,
      "reason" varchar(500),
      "decidedAt" timestamptz NOT NULL DEFAULT now(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_roster_identity_decision" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_roster_identity_decision_revision" CHECK ("revision" >= 1),
      CONSTRAINT "CHK_roster_identity_decision_change" CHECK ("fromState" <> "toState"),
      CONSTRAINT "FK_roster_identity_decision_candidate" FOREIGN KEY ("candidateId") REFERENCES "sto_info_app"."fleet_roster_identity_candidate"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_identity_decision_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_identity_decision_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_roster_identity_decision_revision" ON "sto_info_app"."fleet_roster_identity_decision" ("candidateId", "revision")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_identity_decision_fleet_decided" ON "sto_info_app"."fleet_roster_identity_decision" ("fleetId", "decidedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_identity_decision_actor" ON "sto_info_app"."fleet_roster_identity_decision" ("actorUserId")`,
    );

    // The actor is the one column a later event may change, when the user
    // it names is deleted and the foreign key sets it to NULL. Everything
    // else a decision says is what was decided, and stays that.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."roster_identity_decision_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'actorUserId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId')
          OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId") THEN
          RAISE EXCEPTION 'fleet_roster_identity_decision is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_roster_identity_decision_guard" BEFORE UPDATE ON "sto_info_app"."fleet_roster_identity_decision" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."roster_identity_decision_guard"()`,
    );
  }

  /**
   * Reverts the migration.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_roster_identity_decision_guard" ON "sto_info_app"."fleet_roster_identity_decision"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."roster_identity_decision_guard"()`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_identity_decision"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_identity_candidate_link"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_identity_candidate"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_identity_alias"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_identity"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_identity_decision_action_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_identity_collision_reason_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_identity_confidence_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_identity_candidate_state_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_identity_candidate_kind_enum"`,
    );
  }
}
