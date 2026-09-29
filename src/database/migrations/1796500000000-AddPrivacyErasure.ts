import { MigrationInterface, QueryRunner } from 'typeorm';

/** The entities whose audit trail keeps identifiers only (FC-038). */
export const AUDITED_BY_IDENTIFIERS_ONLY = [
  'ChatMessageEntity',
  'ChatMessageReportEntity',
  'ChatReportEvidenceEntity',
  'ChatTranscriptEntity',
  'RosterObservationEntity',
  'RosterIdentityAliasEntity',
  'RosterErasureEntity',
  'NewsPostEntity',
  'FleetApplicationEntity',
  'ContactRequestEntity',
  'UserReportEntity',
] as const;

/** The site-wide notice that the Privacy Policy and Terms changed. */
export const POLICY_NOTICE_ID = '38000000-0000-4000-8000-000000000038';

/** The import log's values before this migration. */
const IMPORT_ACTIONS = [
  'EXCLUDED',
  'REINSTATED',
  'MARKED_PARTIAL',
  'UNMARKED_PARTIAL',
  'ROWS_EXCLUDED',
  'ROWS_REINSTATED',
  'TIMEZONE_CORRECTED',
  'CONFLICT_SELECTED',
  'SOURCE_EXPIRED',
];

/** The import log's CHECK on its action column. */
const IMPORT_ACTION_CHECK = [
  'CHK_roster_import_action_conflict',
  `("action" = 'CONFLICT_SELECTED') = ("conflictGroupId" IS NOT NULL)`,
] as const;

/** Every observation column but those naming the Character. */
const OBSERVATION_FIXED = [
  'importSourceId',
  'fleetId',
  'line',
  'level',
  'className',
  'profession',
  'guildRank',
  'contributionTotal',
  'joinedAtLocal',
  'rankChangedAtLocal',
  'lastActiveAtLocal',
  'status',
  'publicCommentEditedAtLocal',
];

/** The observation columns that name the Character. */
const OBSERVATION_NAMED = [
  'characterName',
  'characterNameNormalised',
  'accountHandle',
  'accountHandleNormalised',
  'publicComment',
];

/**
 * The observation guard's test for a change to some columns.
 *
 * @param columns - The columns.
 * @returns The condition.
 */
const changed = (columns: readonly string[]): string =>
  columns
    .map(column => `NEW."${column}" IS DISTINCT FROM OLD."${column}"`)
    .join('\n          OR ');

/**
 * The observation guard: write-once, but for a verified erasure, which may
 * rewrite the name, the handle and the comment, and only into the erased
 * form (FC-038).
 *
 * @param erasable - Whether erasure may pass.
 * @returns The function.
 */
const observationGuard = (
  erasable: boolean,
): string => `CREATE OR REPLACE FUNCTION "sto_info_app"."roster_observation_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF ${changed(OBSERVATION_FIXED)}${
          erasable
            ? `
          OR ((${changed(OBSERVATION_NAMED)})
            AND NOT (NEW."characterName" = '${ERASED_NAME}'
              AND NEW."accountHandle" LIKE '@erased-%'
              AND NEW."publicComment" = '')) THEN`
            : `
          OR ${changed(OBSERVATION_NAMED)} THEN`
        }
          RAISE EXCEPTION 'fleet_roster_observation is write-once' USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`;

/** What an erased Character is called, as the guard allows it. */
const ERASED_NAME = 'Erased member';

/**
 * Keeps a JSON snapshot's identifiers and nothing else.
 *
 * @param column - The column.
 * @returns The expression.
 */
const identifiersOf = (column: string): string =>
  `(SELECT json_object_agg(key, value) FROM json_each("${column}") WHERE key = 'id' OR key LIKE '%Id')`;

/**
 * Privacy claims, account erasure and telemetry masking (FC-038).
 *
 * With Steve's decisions of 29 September 2026:
 *
 * - **Roster erasure.** `roster_erasure` records each verified erasure of a
 *   Character name and @handle: a keyed hash of the pair (never the pair),
 *   the pseudonym that replaces it, why and who. Write-once. It is also the
 *   suppression list every import is scrubbed against. Observations stay
 *   write-once but for the one rewrite an erasure makes: name, handle and
 *   comment into the erased form, and nothing else.
 * - **An erased file.** A held import whose file an erasure deletes is
 *   retired, and its log says so (`SOURCE_ERASED`).
 * - **A departed Owner.** A Community whose Owner's account is erased keeps
 *   no Owner, which only a closed one may do: an Owner who closes their
 *   account hands each open Community to an Admin or closes it first.
 * - **Audit.** Chat, roster, news and form-content entities keep only their
 *   identifiers in `_audit`, and what was copied before is scrubbed.
 * - **The policies.** One site-wide notice that the Privacy Policy and
 *   Terms now cover Fleets.
 */
export class AddPrivacyErasure1796500000000 implements MigrationInterface {
  name = 'AddPrivacyErasure1796500000000';

  /**
   * Adds the erasure record, lets a closed Community lose its Owner, scrubs
   * the audit trail and posts the notice.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."roster_import_action_enum" ADD VALUE IF NOT EXISTS 'SOURCE_ERASED'`,
    );

    await queryRunner.query(observationGuard(true));

    await queryRunner.query(`CREATE TABLE "sto_info_app"."roster_erasure" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "pairHash" char(64) NOT NULL,
      "pseudonym" varchar(40) NOT NULL,
      "reason" varchar(500) NOT NULL,
      "adminUserId" uuid,
      "replayed" boolean NOT NULL DEFAULT false,
      "counts" jsonb NOT NULL DEFAULT '{}',
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_roster_erasure" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_roster_erasure_pair" UNIQUE ("pairHash"),
      CONSTRAINT "UQ_roster_erasure_pseudonym" UNIQUE ("pseudonym"),
      CONSTRAINT "CHK_roster_erasure_hash" CHECK ("pairHash" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "CHK_roster_erasure_reason" CHECK (length(btrim("reason")) BETWEEN 10 AND 500),
      CONSTRAINT "FK_roster_erasure_admin" FOREIGN KEY ("adminUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."roster_erasure_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'adminUserId') IS DISTINCT FROM (to_jsonb(OLD) - 'adminUserId')
          OR (NEW."adminUserId" IS NOT NULL AND NEW."adminUserId" IS DISTINCT FROM OLD."adminUserId") THEN
          RAISE EXCEPTION 'roster_erasure is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_roster_erasure_guard" BEFORE UPDATE ON "sto_info_app"."roster_erasure" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."roster_erasure_guard"()`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_community" DROP CONSTRAINT "FK_fleet_community_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_community" ALTER COLUMN "ownerUserId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_community" ADD CONSTRAINT "FK_fleet_community_owner" FOREIGN KEY ("ownerUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_community" ADD CONSTRAINT "CHK_fleet_community_owner_closed" CHECK ("ownerUserId" IS NOT NULL OR "status"::text = 'CLOSED')`,
    );

    const entities = AUDITED_BY_IDENTIFIERS_ONLY.map(
      entity => `'${entity}'`,
    ).join(', ');

    await queryRunner.query(
      `UPDATE "sto_info_app"."_audit" SET "oldValue" = ${identifiersOf('oldValue')}, "newValue" = ${identifiersOf('newValue')} WHERE "entity" IN (${entities})`,
    );

    await queryRunner.query(
      `INSERT INTO "sto_info_app"."notification" ("id", "target", "severity", "title", "body", "linkUrl") VALUES ($1, 'BROADCAST', 'INFO', $2, $3, '/privacy-policy')`,
      [
        POLICY_NOTICE_ID,
        'Privacy Policy and Terms updated for Fleets',
        'Our Privacy Policy and Terms of Use now cover Fleet Communities: ' +
          'what a roster upload keeps and discards, how files are scanned, ' +
          'what STO Info works out from rosters, and who can read chat and ' +
          'for how long.',
      ],
    );
  }

  /**
   * Reverts the migration. The audit trail's scrubbed content does not come
   * back. Fails while a closed Community has no Owner, which is the honest
   * outcome: nothing it could be given would be true.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."notification" WHERE "id" = $1`,
      [POLICY_NOTICE_ID],
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_community" DROP CONSTRAINT "CHK_fleet_community_owner_closed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_community" DROP CONSTRAINT "FK_fleet_community_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_community" ALTER COLUMN "ownerUserId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_community" ADD CONSTRAINT "FK_fleet_community_owner" FOREIGN KEY ("ownerUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`DROP TABLE "sto_info_app"."roster_erasure"`);
    await queryRunner.query(observationGuard(false));
    await queryRunner.query(
      `DROP FUNCTION "sto_info_app"."roster_erasure_guard"()`,
    );

    const table = `"sto_info_app"."fleet_roster_import_action"`;
    const type = `"sto_info_app"."roster_import_action_enum"`;
    const [name, check] = IMPORT_ACTION_CHECK;

    await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT "${name}"`);
    await queryRunner.query(
      `DELETE FROM ${table} WHERE "action"::text = 'SOURCE_ERASED'`,
    );
    await queryRunner.query(
      `ALTER TYPE ${type} RENAME TO "roster_import_action_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE ${type} AS ENUM (${IMPORT_ACTIONS.map(value => `'${value}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE ${table} ALTER COLUMN "action" TYPE ${type} USING "action"::text::${type}`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_import_action_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${table} ADD CONSTRAINT "${name}" CHECK (${check})`,
    );
  }
}
