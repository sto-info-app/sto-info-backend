import { MigrationInterface, QueryRunner } from 'typeorm';

/** A CHECK on an action column, before this migration and after it. */
interface ActionCheck {
  readonly name: string;
  readonly before: string;
  readonly after: string;
}

/** A type this migration adds values to, and the values it had before. */
interface Extended {
  readonly type: string;
  readonly table: string;
  readonly column: string;
  readonly previous: readonly string[];
  readonly added: readonly string[];
  /** Its table's CHECKs on the column, dropped and remade around a change. */
  readonly checks: readonly ActionCheck[];
}

/** A reason that is there and not blank. */
const REASON = `("reason" IS NOT NULL AND length(btrim("reason")) > 0)`;

/** The two logs that learn about suspension. */
const EXTENDED: readonly Extended[] = [
  {
    type: 'scope_membership_action_enum',
    table: 'scope_membership_action',
    column: 'action',
    previous: ['APPROVED', 'LEFT', 'REMOVED'],
    added: ['SUSPENDED', 'REINSTATED'],
    checks: [
      {
        name: 'CHK_scope_membership_action_removal_reason',
        before: `"action" <> 'REMOVED' OR ${REASON}`,
        // Compared as text: a value added to a type cannot be used in the
        // transaction that added it.
        after: `"action"::text NOT IN ('REMOVED', 'SUSPENDED', 'REINSTATED') OR ${REASON}`,
      },
    ],
  },
  {
    type: 'scope_governance_action_enum',
    table: 'scope_governance_action',
    column: 'action',
    previous: [
      'ROLE_ASSIGNED',
      'ROLE_WITHDRAWN',
      'CAPABILITY_GRANTED',
      'CAPABILITY_DENIED',
      'CAPABILITY_CLEARED',
      'OWNERSHIP_OFFERED',
      'OWNERSHIP_ACCEPTED',
      'OWNERSHIP_DECLINED',
      'OWNERSHIP_CANCELLED',
      'OWNERSHIP_REASSIGNED',
      'CLOSED',
    ],
    added: ['SUSPENDED', 'REINSTATED'],
    checks: [
      {
        name: 'CHK_scope_governance_action_reason',
        before: `"action" NOT IN ('ROLE_WITHDRAWN', 'CAPABILITY_DENIED', 'OWNERSHIP_REASSIGNED', 'CLOSED') OR ${REASON}`,
        after: `"action"::text NOT IN ('ROLE_WITHDRAWN', 'CAPABILITY_DENIED', 'OWNERSHIP_REASSIGNED', 'CLOSED', 'SUSPENDED', 'REINSTATED') OR ${REASON}`,
      },
      {
        name: 'CHK_scope_governance_action_site_admin',
        before: `NOT "asSiteAdmin" OR "action" IN ('OWNERSHIP_REASSIGNED', 'OWNERSHIP_CANCELLED', 'CLOSED')`,
        after: `NOT "asSiteAdmin" OR "action"::text IN ('OWNERSHIP_REASSIGNED', 'OWNERSHIP_CANCELLED', 'CLOSED', 'SUSPENDED', 'REINSTATED')`,
      },
      // Unchanged, but on the column, so they go and come back with it.
      ...[
        [
          'CHK_scope_governance_action_cleared_grant_reason',
          `"action" <> 'CAPABILITY_CLEARED' OR "clearedEffect" <> 'GRANT' OR ${REASON}`,
        ],
        [
          'CHK_scope_governance_action_role',
          `"action" NOT IN ('ROLE_ASSIGNED', 'ROLE_WITHDRAWN') OR "role" IS NOT NULL`,
        ],
        [
          'CHK_scope_governance_action_capability',
          `("action" IN ('CAPABILITY_GRANTED', 'CAPABILITY_DENIED', 'CAPABILITY_CLEARED')) = ("capability" IS NOT NULL)`,
        ],
        [
          'CHK_scope_governance_action_cleared_effect',
          `("action" = 'CAPABILITY_CLEARED') = ("clearedEffect" IS NOT NULL)`,
        ],
      ].map(([name, check]) => ({ name, before: check, after: check })),
      {
        name: 'CHK_scope_governance_action_suspension',
        before: '',
        // Only a site admin suspends or reinstates a scope.
        after: `"action"::text NOT IN ('SUSPENDED', 'REINSTATED') OR "asSiteAdmin"`,
      },
    ],
  },
];

/**
 * Fleet administration and moderation investigations (FC-036).
 *
 * With Steve's decisions of 29 September 2026:
 *
 * - **Suspension.** A member's suspension and reinstatement are logged with
 *   the membership's other actions, and a scope's with its governance
 *   actions, each with a reason; only a site admin suspends a scope. Both
 *   status columns already had `SUSPENDED`; nothing could set it until now.
 * - **Holds.** `moderation_hold` keeps a chat report's evidence past its
 *   90 days, or everything one member wrote in chat past the 45-day purge,
 *   with a reason, an owning admin, a review date and a release. It has no
 *   key to the report: the purge leaves a held report alone, and a released
 *   hold's record outlives the report it held. Its log,
 *   `moderation_hold_action`, records each placing, extension, release and
 *   reading, the last with its purpose, and is write-once.
 * - **Investigations.** `fleet_investigation_grant` is a site admin's
 *   24-hour, read-only look at one Fleet's imports, with a purpose. The row
 *   is the record, so it is write-once too.
 */
export class AddFleetAdministration1796300000000 implements MigrationInterface {
  name = 'AddFleetAdministration1796300000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const extended of EXTENDED) {
      for (const value of extended.added) {
        await queryRunner.query(
          `ALTER TYPE "sto_info_app"."${extended.type}" ADD VALUE IF NOT EXISTS '${value}'`,
        );
      }

      await remakeChecks(queryRunner, extended, 'after');
    }

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."moderation_hold_kind_enum" AS ENUM ('CHAT_REPORT', 'MEMBER_MESSAGES')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."moderation_hold_action_kind_enum" AS ENUM ('PLACED', 'EXTENDED', 'RELEASED', 'READ')`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."moderation_hold" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "kind" "sto_info_app"."moderation_hold_kind_enum" NOT NULL,
      "chatReportId" uuid,
      "subjectUserId" uuid,
      "reason" varchar(500) NOT NULL,
      "ownerUserId" uuid,
      "reviewAt" timestamptz NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "releasedAt" timestamptz,
      "releasedByUserId" uuid,
      "releaseReason" varchar(500),
      CONSTRAINT "PK_moderation_hold" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_moderation_hold_subject" CHECK (("kind" = 'CHAT_REPORT' AND "chatReportId" IS NOT NULL AND "subjectUserId" IS NULL) OR ("kind" = 'MEMBER_MESSAGES' AND "chatReportId" IS NULL)),
      CONSTRAINT "CHK_moderation_hold_reason" CHECK (length(btrim("reason")) > 0),
      CONSTRAINT "CHK_moderation_hold_release" CHECK (("releasedAt" IS NULL) = ("releaseReason" IS NULL)),
      CONSTRAINT "FK_moderation_hold_subject" FOREIGN KEY ("subjectUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_moderation_hold_owner" FOREIGN KEY ("ownerUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_moderation_hold_releaser" FOREIGN KEY ("releasedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_moderation_hold_report" ON "sto_info_app"."moderation_hold" ("chatReportId") WHERE "releasedAt" IS NULL AND "chatReportId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_moderation_hold_subject" ON "sto_info_app"."moderation_hold" ("subjectUserId") WHERE "releasedAt" IS NULL AND "subjectUserId" IS NOT NULL`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."moderation_hold_action" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "holdId" uuid NOT NULL,
      "action" "sto_info_app"."moderation_hold_action_kind_enum" NOT NULL,
      "actorUserId" uuid,
      "reason" varchar(500) NOT NULL,
      "detail" jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_moderation_hold_action" PRIMARY KEY ("id"),
      CONSTRAINT "FK_moderation_hold_action_hold" FOREIGN KEY ("holdId") REFERENCES "sto_info_app"."moderation_hold"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_moderation_hold_action_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_moderation_hold_action_hold" ON "sto_info_app"."moderation_hold_action" ("holdId", "createdAt")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_investigation_grant" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "adminUserId" uuid,
      "purpose" varchar(500) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "expiresAt" timestamptz NOT NULL,
      CONSTRAINT "PK_fleet_investigation_grant" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_fleet_investigation_grant_purpose" CHECK (length(btrim("purpose")) BETWEEN 10 AND 500),
      CONSTRAINT "CHK_fleet_investigation_grant_window" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '24 hours'),
      CONSTRAINT "FK_fleet_investigation_grant_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_fleet_investigation_grant_admin" FOREIGN KEY ("adminUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_investigation_grant_admin" ON "sto_info_app"."fleet_investigation_grant" ("adminUserId", "fleetId", "expiresAt")`,
    );

    // Both logs are write-once, but for the accounts they name going.
    for (const [table, columns] of [
      ['moderation_hold_action', ['actorUserId']],
      ['fleet_investigation_grant', ['adminUserId']],
    ] as const) {
      const minus = columns.map(column => ` - '${column}'`).join('');
      const cleared = columns
        .map(
          column =>
            ` OR (NEW."${column}" IS NOT NULL AND NEW."${column}" IS DISTINCT FROM OLD."${column}")`,
        )
        .join('');

      await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."${table}_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW)${minus}) IS DISTINCT FROM (to_jsonb(OLD)${minus})${cleared} THEN
          RAISE EXCEPTION '${table} is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
      await queryRunner.query(
        `CREATE TRIGGER "TR_${table}_guard" BEFORE UPDATE ON "sto_info_app"."${table}" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."${table}_guard"()`,
      );
    }
  }

  /**
   * Reverts the migration: holds, their log and investigation grants go,
   * and the two logs forget suspension. PostgreSQL cannot take a value out
   * of a type, so each type is made again without them.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'fleet_investigation_grant',
      'moderation_hold_action',
    ]) {
      await queryRunner.query(`DROP TABLE "sto_info_app"."${table}"`);
      await queryRunner.query(
        `DROP FUNCTION "sto_info_app"."${table}_guard"()`,
      );
    }

    await queryRunner.query(`DROP TABLE "sto_info_app"."moderation_hold"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."moderation_hold_action_kind_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."moderation_hold_kind_enum"`,
    );

    for (const extended of EXTENDED) {
      const added = extended.added.map(value => `'${value}'`).join(', ');
      const previous = extended.previous.map(value => `'${value}'`).join(', ');
      const type = `"sto_info_app"."${extended.type}"`;

      await dropChecks(queryRunner, extended);
      await queryRunner.query(
        `DELETE FROM "sto_info_app"."${extended.table}" WHERE "${extended.column}"::text IN (${added})`,
      );
      await queryRunner.query(
        `ALTER TYPE ${type} RENAME TO "${extended.type}_old"`,
      );
      await queryRunner.query(`CREATE TYPE ${type} AS ENUM (${previous})`);
      await queryRunner.query(
        `ALTER TABLE "sto_info_app"."${extended.table}" ALTER COLUMN "${extended.column}" TYPE ${type} USING "${extended.column}"::text::${type}`,
      );
      await queryRunner.query(
        `DROP TYPE "sto_info_app"."${extended.type}_old"`,
      );
      await remakeChecks(queryRunner, extended, 'before');
    }
  }
}

/**
 * Drops a table's CHECKs on its action column.
 *
 * @param queryRunner - The TypeORM query runner.
 * @param extended - The table and its CHECKs.
 */
async function dropChecks(
  queryRunner: QueryRunner,
  extended: Extended,
): Promise<void> {
  for (const check of extended.checks) {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."${extended.table}" DROP CONSTRAINT IF EXISTS "${check.name}"`,
    );
  }
}

/**
 * Makes a table's CHECKs on its action column again, as they were before
 * this migration or as it leaves them. A CHECK that did not exist before is
 * not made again.
 *
 * @param queryRunner - The TypeORM query runner.
 * @param extended - The table and its CHECKs.
 * @param which - Which version of each.
 */
async function remakeChecks(
  queryRunner: QueryRunner,
  extended: Extended,
  which: 'before' | 'after',
): Promise<void> {
  if (which === 'after') {
    await dropChecks(queryRunner, extended);
  }

  for (const check of extended.checks) {
    if (check[which] !== '') {
      await queryRunner.query(
        `ALTER TABLE "sto_info_app"."${extended.table}" ADD CONSTRAINT "${check.name}" CHECK (${check[which]})`,
      );
    }
  }
}
