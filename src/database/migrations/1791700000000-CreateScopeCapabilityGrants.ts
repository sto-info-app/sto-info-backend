import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the scoped capability delegation table (FC-005).
 *
 * One new table and one new enum type. Nothing existing is altered, so this can
 * be applied independently of the services that read it.
 *
 * It is a separate migration rather than an addition to FC-004's because that
 * one has been applied and rehearsed; editing an applied migration changes what
 * a fresh database gets without changing what an existing one has, which is the
 * one way a schema can differ between environments while every check still
 * passes.
 *
 * Three things here carry the ticket's acceptance criteria.
 *
 * **A subject is a role label or a person, never both, and never neither.**
 * `num_nonnulls("subjectUserId", "subjectRole") = 1` — equality, not `<= 1`, so
 * a row that grants a capability to nobody in particular cannot be written. The
 * two shapes exist because configuring a Fleet ("Officers here may import
 * rosters") and trusting one person ("this Officer may export transcripts") are
 * genuinely different acts, and collapsing them would force an Owner to widen a
 * capability to everybody in order to give it to one person.
 *
 * **An open GRANT and an open DENY for the same subject and capability cannot
 * both exist.** The open-grant indexes are unique on scope, subject and
 * capability and do not include the effect, so the contradiction is refused at
 * the point of writing rather than resolved silently at the point of reading.
 * DENY beating GRANT is still the resolver's rule — this just means it never
 * has to apply it to two rows that were both meant sincerely.
 *
 * **Cross-community delegation is impossible rather than detected.** The Fleet
 * and Armada foreign keys are composite against `(id, communityId)`, exactly as
 * in FC-004, so a grant naming another Community's Fleet has no row to
 * reference. PostgreSQL's `MATCH SIMPLE` stands the constraint aside when the
 * child ID is null and checks both columns together when it is set.
 *
 * The capability itself is `varchar` rather than an enum type. The vocabulary
 * grows with every workstream, and an enum would make each addition a migration
 * against a live table; an unrecognised code confers nothing, so a stale grant
 * is inert.
 */
export class CreateScopeCapabilityGrants1791700000000 implements MigrationInterface {
  name = 'CreateScopeCapabilityGrants1791700000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."scope_capability_effect_enum" AS ENUM ('GRANT', 'DENY')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_capability_grant" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "fleetId" uuid,
      "armadaId" uuid,
      "subjectUserId" uuid,
      "subjectRole" "sto_info_app"."fleet_scope_role_enum",
      "capability" varchar(100) NOT NULL,
      "effect" "sto_info_app"."scope_capability_effect_enum" NOT NULL,
      "validFrom" timestamptz NOT NULL DEFAULT now(),
      "validTo" timestamptz,
      "grantedByUserId" uuid,
      "reason" varchar(500),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      CONSTRAINT "PK_scope_capability_grant" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_scope_capability_grant_single_scope" CHECK (num_nonnulls("fleetId", "armadaId") <= 1),
      CONSTRAINT "CHK_scope_capability_grant_single_subject" CHECK (num_nonnulls("subjectUserId", "subjectRole") = 1),
      CONSTRAINT "CHK_scope_capability_grant_interval" CHECK ("validTo" IS NULL OR "validTo" > "validFrom"),
      CONSTRAINT "FK_scope_capability_grant_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_capability_grant_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_capability_grant_armada" FOREIGN KEY ("armadaId", "communityId") REFERENCES "sto_info_app"."sto_armada"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_capability_grant_subject" FOREIGN KEY ("subjectUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_capability_grant_granted_by" FOREIGN KEY ("grantedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);

    // Six partial unique indexes rather than one clever expression index: one
    // per scope kind and subject kind. A COALESCE over the three scope columns
    // would be shorter and would also silently treat a Fleet grant and an
    // Armada grant with the same UUID as the same row.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_capability_grant_open_community_user" ON "sto_info_app"."scope_capability_grant" ("communityId", "subjectUserId", "capability") WHERE "fleetId" IS NULL AND "armadaId" IS NULL AND "subjectUserId" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_capability_grant_open_community_role" ON "sto_info_app"."scope_capability_grant" ("communityId", "subjectRole", "capability") WHERE "fleetId" IS NULL AND "armadaId" IS NULL AND "subjectRole" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_capability_grant_open_fleet_user" ON "sto_info_app"."scope_capability_grant" ("fleetId", "subjectUserId", "capability") WHERE "fleetId" IS NOT NULL AND "subjectUserId" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_capability_grant_open_fleet_role" ON "sto_info_app"."scope_capability_grant" ("fleetId", "subjectRole", "capability") WHERE "fleetId" IS NOT NULL AND "subjectRole" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_capability_grant_open_armada_user" ON "sto_info_app"."scope_capability_grant" ("armadaId", "subjectUserId", "capability") WHERE "armadaId" IS NOT NULL AND "subjectUserId" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_capability_grant_open_armada_role" ON "sto_info_app"."scope_capability_grant" ("armadaId", "subjectRole", "capability") WHERE "armadaId" IS NOT NULL AND "subjectRole" IS NOT NULL AND "validTo" IS NULL AND "deletedAt" IS NULL`,
    );

    // Resolving one user's capabilities reads every grant naming them across
    // every scope in one query; without this it is a sequential scan on a table
    // that grows with delegation rather than with membership.
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_capability_grant_subject_user" ON "sto_info_app"."scope_capability_grant" ("subjectUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_capability_grant_community" ON "sto_info_app"."scope_capability_grant" ("communityId")`,
    );
  }

  /**
   * Reverts the migration.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."scope_capability_grant"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."scope_capability_effect_enum"`,
    );
  }
}
