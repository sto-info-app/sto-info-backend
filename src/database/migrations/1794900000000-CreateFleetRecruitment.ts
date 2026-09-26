import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recruitment, applications, invitations and the membership they grant
 * (FC-021).
 *
 * Plan R07 and R08, and Steve's decisions of 26 September 2026:
 *
 * - **Four ways in, one record.** An application a decider accepts, an OPEN
 *   Fleet's join and an accepted invitation all leave a `fleet_application`
 *   row, told apart by `route`. Every membership the feature grants therefore
 *   has one record of how it came about.
 * - **A form edit never rewrites an answer.** `fleet_recruitment_settings` is
 *   versioned and write-once: each change to the state, the requirements or
 *   the questions is a new row, and an application keeps the version it
 *   answered. `sto_fleet.recruitmentState` stays the current state, for the
 *   directory, and changes with each version in the same transaction.
 * - **One pending application per Character per Fleet**, by a partial unique
 *   index. A person may apply to several Fleets at once, and may apply again
 *   as soon as an application is decided or withdrawn.
 * - **A rejection carries its reason**, which the applicant is shown. An
 *   acceptance may carry a note.
 * - **An invitation lapses after 14 days.** Expiry is a date read when it is
 *   needed, as a proposal's is, and `LAPSED` is set only when an expired
 *   invitation is replaced by a new one.
 * - **Acceptance grants access and proposes the association.** The Character
 *   is not moved into the Fleet: its owner is asked, by a proposal carrying
 *   the application's ID, once the in-game invitation has happened.
 * - **Every grant, departure and removal is logged** in
 *   `scope_membership_action`, because a membership row is updated in place
 *   and would otherwise forget all but its latest state. A removal needs a
 *   reason.
 *
 * Nothing here reads the roster. A roster match is evidence a decider is
 * shown, and no column or constraint lets it approve anything — the story's
 * third criterion.
 */
export class CreateFleetRecruitment1794900000000 implements MigrationInterface {
  name = 'CreateFleetRecruitment1794900000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."fleet_application_route_enum" AS ENUM ('APPLICATION', 'OPEN_JOIN', 'INVITATION')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."fleet_application_status_enum" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."fleet_application_action_enum" AS ENUM ('SUBMITTED', 'WITHDRAWN', 'ACCEPTED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."fleet_invitation_status_enum" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'LAPSED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."scope_membership_action_enum" AS ENUM ('APPROVED', 'LEFT', 'REMOVED')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_recruitment_settings" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "version" integer NOT NULL,
      "recruitmentState" "sto_info_app"."fleet_recruitment_state_enum" NOT NULL,
      "requirementsText" varchar(2000),
      "minimumLevel" integer,
      "factionIds" uuid[] NOT NULL DEFAULT '{}',
      "questions" jsonb NOT NULL DEFAULT '[]',
      "createdByUserId" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_fleet_recruitment_settings" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_fleet_recruitment_settings_version" UNIQUE ("fleetId", "version"),
      CONSTRAINT "CHK_fleet_recruitment_settings_version" CHECK ("version" >= 1),
      CONSTRAINT "CHK_fleet_recruitment_settings_level" CHECK ("minimumLevel" IS NULL OR "minimumLevel" BETWEEN 1 AND 100),
      CONSTRAINT "CHK_fleet_recruitment_settings_factions" CHECK (cardinality("factionIds") <= 20),
      CONSTRAINT "CHK_fleet_recruitment_settings_questions" CHECK (jsonb_typeof("questions") = 'array' AND jsonb_array_length("questions") <= 20),
      CONSTRAINT "FK_fleet_recruitment_settings_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_recruitment_settings_created_by" FOREIGN KEY ("createdByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_invitation" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "invitedUserId" uuid NOT NULL,
      "invitedByUserId" uuid,
      "status" "sto_info_app"."fleet_invitation_status_enum" NOT NULL DEFAULT 'PENDING',
      "expiresAt" timestamptz NOT NULL,
      "answeredAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_fleet_invitation" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_fleet_invitation_answered" CHECK (("status" = 'PENDING') = ("answeredAt" IS NULL)),
      CONSTRAINT "CHK_fleet_invitation_expiry" CHECK ("expiresAt" > "createdAt"),
      CONSTRAINT "FK_fleet_invitation_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_invitation_invited" FOREIGN KEY ("invitedUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_invitation_invited_by" FOREIGN KEY ("invitedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_fleet_invitation_open" ON "sto_info_app"."fleet_invitation" ("fleetId", "invitedUserId") WHERE "status" = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_invitation_invited" ON "sto_info_app"."fleet_invitation" ("invitedUserId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_invitation_fleet" ON "sto_info_app"."fleet_invitation" ("fleetId", "createdAt")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_application" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "applicantUserId" uuid NOT NULL,
      "characterId" uuid NOT NULL,
      "route" "sto_info_app"."fleet_application_route_enum" NOT NULL,
      "status" "sto_info_app"."fleet_application_status_enum" NOT NULL DEFAULT 'PENDING',
      "settingsId" uuid,
      "answers" jsonb NOT NULL DEFAULT '[]',
      "invitationId" uuid,
      "submittedAt" timestamptz NOT NULL DEFAULT now(),
      "decidedAt" timestamptz,
      "decidedByUserId" uuid,
      "decisionNote" varchar(1000),
      "withdrawnAt" timestamptz,
      "revision" integer NOT NULL DEFAULT 1,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_fleet_application" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_fleet_application_answers" CHECK (jsonb_typeof("answers") = 'array'),
      CONSTRAINT "CHK_fleet_application_decided" CHECK (("status" IN ('ACCEPTED', 'REJECTED')) = ("decidedAt" IS NOT NULL)),
      CONSTRAINT "CHK_fleet_application_withdrawn" CHECK (("status" = 'WITHDRAWN') = ("withdrawnAt" IS NOT NULL)),
      CONSTRAINT "CHK_fleet_application_rejection_reason" CHECK ("status" <> 'REJECTED' OR ("decisionNote" IS NOT NULL AND length(btrim("decisionNote")) > 0)),
      CONSTRAINT "CHK_fleet_application_immediate" CHECK ("route" = 'APPLICATION' OR "status" = 'ACCEPTED'),
      CONSTRAINT "CHK_fleet_application_invitation" CHECK (("route" = 'INVITATION') = ("invitationId" IS NOT NULL)),
      CONSTRAINT "CHK_fleet_application_revision" CHECK ("revision" >= 1),
      CONSTRAINT "FK_fleet_application_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_application_applicant" FOREIGN KEY ("applicantUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_application_character" FOREIGN KEY ("characterId") REFERENCES "sto_info_app"."character"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_application_settings" FOREIGN KEY ("settingsId") REFERENCES "sto_info_app"."fleet_recruitment_settings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_application_invitation" FOREIGN KEY ("invitationId") REFERENCES "sto_info_app"."fleet_invitation"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_application_decided_by" FOREIGN KEY ("decidedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_fleet_application_pending" ON "sto_info_app"."fleet_application" ("fleetId", "characterId") WHERE "status" = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_application_inbox" ON "sto_info_app"."fleet_application" ("fleetId", "status", "submittedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_application_applicant" ON "sto_info_app"."fleet_application" ("applicantUserId", "submittedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_application_character" ON "sto_info_app"."fleet_application" ("characterId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_application_action" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "applicationId" uuid NOT NULL,
      "action" "sto_info_app"."fleet_application_action_enum" NOT NULL,
      "actorUserId" uuid,
      "note" varchar(1000),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_fleet_application_action" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_fleet_application_action_rejection_reason" CHECK ("action" <> 'REJECTED' OR ("note" IS NOT NULL AND length(btrim("note")) > 0)),
      CONSTRAINT "FK_fleet_application_action_application" FOREIGN KEY ("applicationId") REFERENCES "sto_info_app"."fleet_application"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_application_action_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_application_action_application" ON "sto_info_app"."fleet_application_action" ("applicationId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_application_action_actor" ON "sto_info_app"."fleet_application_action" ("actorUserId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_membership_action" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "membershipId" uuid NOT NULL,
      "action" "sto_info_app"."scope_membership_action_enum" NOT NULL,
      "actorUserId" uuid,
      "reason" varchar(500),
      "applicationId" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_scope_membership_action" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_scope_membership_action_removal_reason" CHECK ("action" <> 'REMOVED' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0)),
      CONSTRAINT "FK_scope_membership_action_membership" FOREIGN KEY ("membershipId") REFERENCES "sto_info_app"."scope_membership"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_membership_action_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_membership_action_application" FOREIGN KEY ("applicationId") REFERENCES "sto_info_app"."fleet_application"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_membership_action_membership" ON "sto_info_app"."scope_membership_action" ("membershipId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_membership_action_actor" ON "sto_info_app"."scope_membership_action" ("actorUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_membership_action_application" ON "sto_info_app"."scope_membership_action" ("applicationId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD COLUMN "applicationId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD CONSTRAINT "FK_character_fleet_proposal_application" FOREIGN KEY ("applicationId") REFERENCES "sto_info_app"."fleet_application"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_character_fleet_proposal_application" ON "sto_info_app"."character_fleet_proposal" ("applicationId")`,
    );

    // A settings version and a logged action are evidence. As with an import
    // correction, the one change a later event may make is the actor going,
    // when their account is deleted.
    for (const [table, actor] of [
      ['fleet_recruitment_settings', 'createdByUserId'],
      ['fleet_application_action', 'actorUserId'],
      ['scope_membership_action', 'actorUserId'],
    ] as const) {
      await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."${table}_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - '${actor}') IS DISTINCT FROM (to_jsonb(OLD) - '${actor}')
          OR (NEW."${actor}" IS NOT NULL AND NEW."${actor}" IS DISTINCT FROM OLD."${actor}") THEN
          RAISE EXCEPTION '${table} is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
      await queryRunner.query(
        `CREATE TRIGGER "TR_${table}_guard" BEFORE UPDATE ON "sto_info_app"."${table}" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."${table}_guard"()`,
      );
    }

    // What was asked and what was answered never change. A decision is made
    // once, from PENDING, and only the decider may later go, with their
    // account.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."fleet_application_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."communityId" IS DISTINCT FROM OLD."communityId"
          OR NEW."fleetId" IS DISTINCT FROM OLD."fleetId"
          OR NEW."applicantUserId" IS DISTINCT FROM OLD."applicantUserId"
          OR NEW."characterId" IS DISTINCT FROM OLD."characterId"
          OR NEW."route" IS DISTINCT FROM OLD."route"
          OR NEW."settingsId" IS DISTINCT FROM OLD."settingsId"
          OR NEW."answers" IS DISTINCT FROM OLD."answers"
          OR NEW."invitationId" IS DISTINCT FROM OLD."invitationId"
          OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
          OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
          RAISE EXCEPTION 'An application cannot change what was asked or answered' USING ERRCODE = '23514';
        END IF;
        IF OLD."status" <> 'PENDING' AND (
          NEW."status" IS DISTINCT FROM OLD."status"
          OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt"
          OR NEW."decisionNote" IS DISTINCT FROM OLD."decisionNote"
          OR NEW."withdrawnAt" IS DISTINCT FROM OLD."withdrawnAt"
          OR (NEW."decidedByUserId" IS NOT NULL AND NEW."decidedByUserId" IS DISTINCT FROM OLD."decidedByUserId")) THEN
          RAISE EXCEPTION 'A decided application cannot be changed' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_fleet_application_guard" BEFORE UPDATE ON "sto_info_app"."fleet_application" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."fleet_application_guard"()`,
    );
  }

  /**
   * Reverts the migration. Applications, invitations, form versions and the
   * membership log go with it; the memberships they granted stay, since the
   * earlier schema has them already.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_fleet_application_guard" ON "sto_info_app"."fleet_application"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."fleet_application_guard"()`,
    );

    for (const table of [
      'scope_membership_action',
      'fleet_application_action',
      'fleet_recruitment_settings',
    ]) {
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS "TR_${table}_guard" ON "sto_info_app"."${table}"`,
      );
      await queryRunner.query(
        `DROP FUNCTION IF EXISTS "sto_info_app"."${table}_guard"()`,
      );
    }

    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_fleet_proposal_application"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" DROP CONSTRAINT "FK_character_fleet_proposal_application"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" DROP COLUMN "applicationId"`,
    );

    await queryRunner.query(
      `DROP TABLE "sto_info_app"."scope_membership_action"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_application_action"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."fleet_application"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."fleet_invitation"`);
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_recruitment_settings"`,
    );

    await queryRunner.query(
      `DROP TYPE "sto_info_app"."scope_membership_action_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."fleet_invitation_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."fleet_application_action_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."fleet_application_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."fleet_application_route_enum"`,
    );
  }
}
