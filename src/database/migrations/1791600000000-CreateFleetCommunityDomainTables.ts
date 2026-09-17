import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the Fleet Community domain and temporal schema (FC-004).
 *
 * Every table is new, so the migration is purely additive and can be applied
 * well ahead of the services and routes that will use it. Nothing outside the
 * feature is altered: the only existing tables touched are `user`, `character`,
 * `platform` and `character_general_faction`, and only as foreign-key targets.
 *
 * Three things here are deliberate and are the point of the ticket.
 *
 * **Instants are `timestamptz`, unlike the rest of this database.** ADR-0007.
 * Fleet Community is the first feature whose input carries a timezone — a
 * roster exported from `America/New_York` and one from `Europe/London` have to
 * reconcile to the same instants — so the column type refuses a naive local
 * value rather than storing it as though it were UTC.
 *
 * **The invariants the acceptance criteria call out are indexes, not service
 * checks.** "One current personal membership per Character" and "one current
 * Armada membership per Fleet" are qualified by "under concurrent writes", and
 * two requests can both pass a read-then-write. Partial unique indexes over the
 * open rows are the database's answer and cannot be raced.
 *
 * **Cross-community references are made impossible rather than detected.**
 * `armada_fleet_membership`, `scope_membership` and `scope_role_assignment` all
 * carry `communityId`, and their Fleet and Armada foreign keys are composite
 * against `(id, communityId)`. A request that smuggles another Community's
 * Fleet ID into the body does not fail a check — there is simply no row to
 * reference. PostgreSQL's default `MATCH SIMPLE` is what makes this work where
 * the child ID is nullable: the constraint stands aside when the ID is null and
 * checks both columns together when it is set.
 *
 * What is deliberately *not* here: `character_fleet_proposal` and the
 * `proposalId` column that references it (FC-014), the Armada configuration
 * columns (FC-024), and every roster, import, event, chat and asset table
 * (W02 onward). Historical-interval overlap validation is a service rule under
 * a row lock rather than a constraint, because it is a range property; that is
 * FC-014 and FC-024.
 */
export class CreateFleetCommunityDomainTables1791600000000 implements MigrationInterface {
  name = 'CreateFleetCommunityDomainTables1791600000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."fleet_scope_status_enum" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."fleet_recruitment_state_enum" AS ENUM ('OPEN', 'APPLICATION', 'INVITE_ONLY', 'CLOSED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."fleet_audience_enum" AS ENUM ('PUBLIC', 'COMMUNITY', 'FLEET_MEMBERS', 'PRIVATE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."armada_position_enum" AS ENUM ('ALPHA', 'BETA', 'GAMMA')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."armada_membership_source_enum" AS ENUM ('MANUAL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."scope_membership_status_enum" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED', 'LEFT', 'REVOKED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."fleet_scope_role_enum" AS ENUM ('OWNER', 'ADMIN', 'OFFICER', 'MEMBER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."character_fleet_membership_source_enum" AS ENUM ('MANUAL', 'APPLICATION', 'CONFIRMED_IMPORT')`,
    );

    // Owner is RESTRICT, not CASCADE: deleting the account behind a live
    // Community must fail and force a transfer, rather than quietly taking
    // every Fleet, Armada and roster history with it.
    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_community" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "ownerUserId" uuid NOT NULL,
      "name" varchar(120) NOT NULL,
      "slug" varchar(80) NOT NULL,
      "description" varchar(2000),
      "recruitmentState" "sto_info_app"."fleet_recruitment_state_enum" NOT NULL DEFAULT 'CLOSED',
      "visibility" "sto_info_app"."fleet_audience_enum" NOT NULL DEFAULT 'PUBLIC',
      "preferredTimezone" varchar(64) NOT NULL DEFAULT 'UTC',
      "status" "sto_info_app"."fleet_scope_status_enum" NOT NULL DEFAULT 'ACTIVE',
      "closedAt" timestamptz,
      "revision" integer NOT NULL DEFAULT 1,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      CONSTRAINT "PK_fleet_community" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_fleet_community_slug_lowercase" CHECK ("slug" = lower("slug")),
      CONSTRAINT "FK_fleet_community_owner" FOREIGN KEY ("ownerUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_fleet_community_slug" ON "sto_info_app"."fleet_community" ("slug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_community_owner" ON "sto_info_app"."fleet_community" ("ownerUserId")`,
    );

    // No unique constraint on (platformId, exactGameName). Two Communities may
    // each hold a record for the same in-game Fleet and neither is
    // authoritative; duplicates are surfaced, never merged. The normalised name
    // is indexed for detection only.
    //
    // UQ_sto_fleet_id_community exists so children can reference (id,
    // communityId) as a composite foreign key. It is redundant as uniqueness —
    // the primary key already guarantees it — and is here purely as a
    // referenceable target.
    await queryRunner.query(`CREATE TABLE "sto_info_app"."sto_fleet" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid,
      "platformId" uuid NOT NULL,
      "allegianceFactionId" uuid,
      "exactGameName" varchar(255) NOT NULL,
      "exactGameNameNormalized" varchar(255) NOT NULL,
      "slug" varchar(80) NOT NULL,
      "recruitmentState" "sto_info_app"."fleet_recruitment_state_enum" NOT NULL DEFAULT 'CLOSED',
      "visibility" "sto_info_app"."fleet_audience_enum" NOT NULL DEFAULT 'COMMUNITY',
      "lastEffectiveImportAt" timestamptz,
      "status" "sto_info_app"."fleet_scope_status_enum" NOT NULL DEFAULT 'ACTIVE',
      "closedAt" timestamptz,
      "revision" integer NOT NULL DEFAULT 1,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      CONSTRAINT "PK_sto_fleet" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_sto_fleet_id_community" UNIQUE ("id", "communityId"),
      CONSTRAINT "CHK_sto_fleet_slug_lowercase" CHECK ("slug" = lower("slug")),
      CONSTRAINT "FK_sto_fleet_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_sto_fleet_platform" FOREIGN KEY ("platformId") REFERENCES "sto_info_app"."platform"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_sto_fleet_allegiance_faction" FOREIGN KEY ("allegianceFactionId") REFERENCES "sto_info_app"."character_general_faction"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_sto_fleet_community_slug" ON "sto_info_app"."sto_fleet" ("communityId", "slug") WHERE "deletedAt" IS NULL AND "communityId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sto_fleet_platform_name" ON "sto_info_app"."sto_fleet" ("platformId", "exactGameNameNormalized")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sto_fleet_community" ON "sto_info_app"."sto_fleet" ("communityId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."sto_armada" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "platformId" uuid NOT NULL,
      "exactGameName" varchar(255) NOT NULL,
      "exactGameNameNormalized" varchar(255) NOT NULL,
      "displayName" varchar(255),
      "slug" varchar(80) NOT NULL,
      "status" "sto_info_app"."fleet_scope_status_enum" NOT NULL DEFAULT 'ACTIVE',
      "closedAt" timestamptz,
      "revision" integer NOT NULL DEFAULT 1,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      CONSTRAINT "PK_sto_armada" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_sto_armada_id_community" UNIQUE ("id", "communityId"),
      CONSTRAINT "CHK_sto_armada_slug_lowercase" CHECK ("slug" = lower("slug")),
      CONSTRAINT "FK_sto_armada_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_sto_armada_platform" FOREIGN KEY ("platformId") REFERENCES "sto_info_app"."platform"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_sto_armada_community_slug" ON "sto_info_app"."sto_armada" ("communityId", "slug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sto_armada_platform_name" ON "sto_info_app"."sto_armada" ("platformId", "exactGameNameNormalized")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_name_alias" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fleetId" uuid NOT NULL,
      "exactName" varchar(255) NOT NULL,
      "exactNameNormalized" varchar(255) NOT NULL,
      "validFrom" timestamptz NOT NULL,
      "validTo" timestamptz,
      "reason" varchar(500) NOT NULL,
      "recordedByUserId" uuid,
      "recordedAt" timestamptz NOT NULL DEFAULT now(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      CONSTRAINT "PK_fleet_name_alias" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_fleet_name_alias_interval" CHECK ("validTo" IS NULL OR "validTo" > "validFrom"),
      CONSTRAINT "FK_fleet_name_alias_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_name_alias_recorded_by" FOREIGN KEY ("recordedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_name_alias_fleet_valid_from" ON "sto_info_app"."fleet_name_alias" ("fleetId", "validFrom")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_name_alias_normalized" ON "sto_info_app"."fleet_name_alias" ("exactNameNormalized")`,
    );

    // The two partial unique indexes below are FC-004's second acceptance
    // criterion for Armadas, and they are indexes rather than service checks
    // because that criterion says "under concurrent writes".
    await queryRunner.query(`CREATE TABLE "sto_info_app"."armada_fleet_membership" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "armadaId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "position" "sto_info_app"."armada_position_enum" NOT NULL,
      "parentMembershipId" uuid,
      "validFrom" timestamptz NOT NULL,
      "validTo" timestamptz,
      "source" "sto_info_app"."armada_membership_source_enum" NOT NULL DEFAULT 'MANUAL',
      "reason" varchar(500),
      "recordedAt" timestamptz NOT NULL DEFAULT now(),
      "recordedByUserId" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      CONSTRAINT "PK_armada_fleet_membership" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_armada_fleet_membership_interval" CHECK ("validTo" IS NULL OR "validTo" > "validFrom"),
      CONSTRAINT "CHK_armada_fleet_membership_parent" CHECK (("position" = 'ALPHA' AND "parentMembershipId" IS NULL) OR ("position" <> 'ALPHA' AND "parentMembershipId" IS NOT NULL)),
      CONSTRAINT "FK_armada_fleet_membership_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_fleet_membership_armada" FOREIGN KEY ("armadaId", "communityId") REFERENCES "sto_info_app"."sto_armada"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_fleet_membership_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_fleet_membership_parent" FOREIGN KEY ("parentMembershipId") REFERENCES "sto_info_app"."armada_fleet_membership"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_fleet_membership_recorded_by" FOREIGN KEY ("recordedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_armada_fleet_membership_open_fleet" ON "sto_info_app"."armada_fleet_membership" ("fleetId") WHERE "validTo" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_armada_fleet_membership_open_alpha" ON "sto_info_app"."armada_fleet_membership" ("armadaId") WHERE "position" = 'ALPHA' AND "validTo" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_armada_fleet_membership_armada_valid_from" ON "sto_info_app"."armada_fleet_membership" ("armadaId", "validFrom")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_armada_fleet_membership_parent" ON "sto_info_app"."armada_fleet_membership" ("parentMembershipId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."community_subscription" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "joinedAt" timestamptz NOT NULL DEFAULT now(),
      "leftAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      CONSTRAINT "PK_community_subscription" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_community_subscription_interval" CHECK ("leftAt" IS NULL OR "leftAt" >= "joinedAt"),
      CONSTRAINT "FK_community_subscription_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_community_subscription_user" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_community_subscription_live" ON "sto_info_app"."community_subscription" ("communityId", "userId") WHERE "leftAt" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_community_subscription_user" ON "sto_info_app"."community_subscription" ("userId")`,
    );

    // Scope is typed columns plus a check, not an object ID and a type string,
    // so an unchecked arbitrary ID cannot reach the table at all.
    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_membership" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "fleetId" uuid,
      "armadaId" uuid,
      "userId" uuid NOT NULL,
      "status" "sto_info_app"."scope_membership_status_enum" NOT NULL DEFAULT 'PENDING',
      "requestedAt" timestamptz NOT NULL DEFAULT now(),
      "decidedAt" timestamptz,
      "decidedByUserId" uuid,
      "decisionReason" varchar(500),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      CONSTRAINT "PK_scope_membership" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_scope_membership_single_scope" CHECK (num_nonnulls("fleetId", "armadaId") <= 1),
      CONSTRAINT "FK_scope_membership_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_membership_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_membership_armada" FOREIGN KEY ("armadaId", "communityId") REFERENCES "sto_info_app"."sto_armada"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_membership_user" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_membership_decided_by" FOREIGN KEY ("decidedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_membership_community_user" ON "sto_info_app"."scope_membership" ("communityId", "userId") WHERE "fleetId" IS NULL AND "armadaId" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_membership_fleet_user" ON "sto_info_app"."scope_membership" ("fleetId", "userId") WHERE "fleetId" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_membership_armada_user" ON "sto_info_app"."scope_membership" ("armadaId", "userId") WHERE "armadaId" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_membership_user_status" ON "sto_info_app"."scope_membership" ("userId", "status")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_role_assignment" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "fleetId" uuid,
      "armadaId" uuid,
      "userId" uuid NOT NULL,
      "role" "sto_info_app"."fleet_scope_role_enum" NOT NULL,
      "validFrom" timestamptz NOT NULL DEFAULT now(),
      "validTo" timestamptz,
      "grantedByUserId" uuid,
      "reason" varchar(500),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      CONSTRAINT "PK_scope_role_assignment" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_scope_role_assignment_single_scope" CHECK (num_nonnulls("fleetId", "armadaId") <= 1),
      CONSTRAINT "CHK_scope_role_assignment_interval" CHECK ("validTo" IS NULL OR "validTo" > "validFrom"),
      CONSTRAINT "FK_scope_role_assignment_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_role_assignment_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_role_assignment_armada" FOREIGN KEY ("armadaId", "communityId") REFERENCES "sto_info_app"."sto_armada"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_role_assignment_user" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_role_assignment_granted_by" FOREIGN KEY ("grantedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_role_assignment_open_community" ON "sto_info_app"."scope_role_assignment" ("communityId", "userId", "role") WHERE "fleetId" IS NULL AND "armadaId" IS NULL AND "validTo" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_role_assignment_open_fleet" ON "sto_info_app"."scope_role_assignment" ("fleetId", "userId", "role") WHERE "fleetId" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_role_assignment_open_armada" ON "sto_info_app"."scope_role_assignment" ("armadaId", "userId", "role") WHERE "armadaId" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_role_assignment_user_role" ON "sto_info_app"."scope_role_assignment" ("userId", "role")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_role_assignment_community_role" ON "sto_info_app"."scope_role_assignment" ("communityId", "role")`,
    );

    // The Fleet reference is RESTRICT so a Fleet record cannot be hard-deleted
    // out from under someone's personal history.
    await queryRunner.query(`CREATE TABLE "sto_info_app"."character_fleet_membership" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "characterId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "validFrom" timestamptz NOT NULL,
      "validTo" timestamptz,
      "source" "sto_info_app"."character_fleet_membership_source_enum" NOT NULL DEFAULT 'MANUAL',
      "visibility" "sto_info_app"."fleet_audience_enum" NOT NULL DEFAULT 'PRIVATE',
      "actorUserId" uuid,
      "recordedAt" timestamptz NOT NULL DEFAULT now(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      CONSTRAINT "PK_character_fleet_membership" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_character_fleet_membership_interval" CHECK ("validTo" IS NULL OR "validTo" > "validFrom"),
      CONSTRAINT "FK_character_fleet_membership_character" FOREIGN KEY ("characterId") REFERENCES "sto_info_app"."character"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_character_fleet_membership_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_character_fleet_membership_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_character_fleet_membership_open" ON "sto_info_app"."character_fleet_membership" ("characterId") WHERE "validTo" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_character_fleet_membership_character_from" ON "sto_info_app"."character_fleet_membership" ("characterId", "validFrom")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_character_fleet_membership_fleet_from" ON "sto_info_app"."character_fleet_membership" ("fleetId", "validFrom")`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."character_fleet_membership"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."scope_role_assignment"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."scope_membership"`);
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."community_subscription"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."armada_fleet_membership"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."fleet_name_alias"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."sto_armada"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."sto_fleet"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."fleet_community"`);

    await queryRunner.query(
      `DROP TYPE "sto_info_app"."character_fleet_membership_source_enum"`,
    );
    await queryRunner.query(`DROP TYPE "sto_info_app"."fleet_scope_role_enum"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."scope_membership_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."armada_membership_source_enum"`,
    );
    await queryRunner.query(`DROP TYPE "sto_info_app"."armada_position_enum"`);
    await queryRunner.query(`DROP TYPE "sto_info_app"."fleet_audience_enum"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."fleet_recruitment_state_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."fleet_scope_status_enum"`,
    );
  }
}
