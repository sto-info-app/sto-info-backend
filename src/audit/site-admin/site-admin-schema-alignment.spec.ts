import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import {
  AddSiteAdminLog1796600000000,
  KEYED_LOGS,
  SITE_ADMIN_ACTIONS,
} from '../../database/migrations/1796600000000-AddSiteAdminLog';
import { IMAGE_ESTATE_ACTIONS } from '../../database/migrations/1796700000000-AddPrivateImageDelivery';
import { RESCAN_ACTIONS } from '../../database/migrations/1796800000000-AddRescanCampaigns';
import { FC050_ACTIONS } from '../../database/migrations/1797100000000-DecideRescanFindings';
import {
  LEDGER_ACTIONS,
  LEDGER_ACTIONS_DOWN_REFUSAL,
  RecordLedgerReconciliation1797200000000,
} from '../../database/migrations/1797200000000-RecordLedgerReconciliation';
import {
  AddOperationsAlerts1797500000000,
  OPERATIONS_ACTIONS,
} from '../../database/migrations/1797500000000-AddOperationsAlerts';
import {
  FEATURE_SWITCH_ACTIONS,
  FEATURE_SWITCH_ACTIONS_DOWN_REFUSAL,
  RecordFeatureSwitchChanges1797700000000,
} from '../../database/migrations/1797700000000-RecordFeatureSwitchChanges';
import { ChatActionEntity } from '../../fleet/chat/entities/chat-action.entity';
import { ChatActionKind } from '../../fleet/chat/enums/chat.enums';
import { ModerationHoldActionEntity } from '../../fleet/chat/holds/moderation-hold-action.entity';
import { ScopeGovernanceActionEntity } from '../../fleet/governance/entities/scope-governance-action.entity';
import { RosterImportActionEntity } from '../../fleet/imports/entities/roster-import-action.entity';
import { SiteAdminActionEntity } from './site-admin-action.entity';
import { SiteAdminActionKind } from './site-admin-action.enum';

/**
 * Runs a migration step and keeps every statement it issues.
 *
 * @param step - The step to run.
 * @returns What it sent to the database, in order.
 */
async function capture(
  step: (queryRunner: QueryRunner) => Promise<void>,
): Promise<string[]> {
  const captured: string[] = [];
  const queryRunner = {
    query: jest.fn((sql: string) => {
      captured.push(sql);

      return Promise.resolve();
    }),
  } as unknown as QueryRunner;

  await step(queryRunner);

  return captured;
}

/**
 * The columns an entity declares.
 *
 * @param entity - Its class.
 * @returns Their names.
 */
const declared = (entity: object): string[] =>
  getMetadataArgsStorage()
    .columns.filter(column => column.target === entity)
    .map(column => column.options.name ?? column.propertyName);

/** Each keyed log's entity, by table. */
const KEYED_ENTITIES: Record<(typeof KEYED_LOGS)[number], object> = {
  scope_governance_action: ScopeGovernanceActionEntity,
  chat_action: ChatActionEntity,
  moderation_hold_action: ModerationHoldActionEntity,
  fleet_roster_import_action: RosterImportActionEntity,
};

/** What the transcript job and sweep record. */
const TRANSCRIPT_OUTCOMES = [
  ChatActionKind.TRANSCRIPT_READY,
  ChatActionKind.TRANSCRIPT_FAILED,
  ChatActionKind.TRANSCRIPT_EXPIRED,
];

/**
 * Holds the site admin log, the logs' idempotency keys and the chat log's
 * transcript outcomes to the code (FC-039). It proves the descriptions
 * agree, not that PostgreSQL accepts them: the migration was run up, down
 * and up again on the local database.
 */
describe('Site admin log schema alignment (FC-039)', () => {
  const migration = new AddSiteAdminLog1796600000000();
  let up: string[];
  let down: string[];

  beforeAll(async () => {
    up = await capture(queryRunner => migration.up(queryRunner));
    down = await capture(queryRunner => migration.down(queryRunner));
  });

  const table = (): string =>
    up.find(statement =>
      statement.includes('CREATE TABLE "sto_info_app"."site_admin_action"'),
    )!;

  it('declares exactly the columns the table is created with', () => {
    const created = table()
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1)));

    expect([...created].sort()).toEqual(
      [...declared(SiteAdminActionEntity)].sort(),
    );
  });

  it('types its instant as timestamptz, and its reason as long as the entity allows', () => {
    expect(table()).toContain('"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL');
    expect(table()).toContain('"reason" varchar(1000) NOT NULL');
  });

  it('gives the action type every action the code knows', () => {
    // FC-040's and FC-041's migrations add the image estate's and the
    // rescan campaigns' actions, and FC-050's, FC-042's and FC-045's theirs;
    // their specs hold that.
    expect([
      ...SITE_ADMIN_ACTIONS,
      ...IMAGE_ESTATE_ACTIONS,
      ...RESCAN_ACTIONS,
      ...FC050_ACTIONS,
      ...LEDGER_ACTIONS,
      ...OPERATIONS_ACTIONS,
      ...FEATURE_SWITCH_ACTIONS,
    ]).toEqual(Object.values(SiteAdminActionKind));
    expect(up[0]).toBe(
      `CREATE TYPE "sto_info_app"."site_admin_action_enum" AS ENUM (${SITE_ADMIN_ACTIONS.map(
        value => `'${value}'`,
      ).join(', ')})`,
    );
  });

  it('needs a reason, and a subject whole or not at all', () => {
    expect(table()).toContain('CHECK (length(btrim("reason")) > 0)');
    expect(table()).toContain(
      'CHECK (("subjectKind" IS NULL) = ("subjectId" IS NULL))',
    );
  });

  // The accounts it names may go, and the audit policy forgets the IP
  // address; nothing else about an entry changes.
  it('keeps an entry write-once, but for its accounts and IP address going', () => {
    const guard = up.find(statement =>
      statement.includes('FUNCTION "sto_info_app"."site_admin_action_guard"'),
    )!;

    expect(guard).toContain(
      `(to_jsonb(NEW) - 'actorUserId' - 'targetUserId' - 'ipAddress')`,
    );
    expect(guard).toContain(
      `NEW."ipAddress" IS NOT NULL AND NEW."ipAddress" IS DISTINCT FROM OLD."ipAddress"`,
    );
    expect(up).toContain(
      'CREATE TRIGGER "TR_site_admin_action_guard" BEFORE UPDATE ON "sto_info_app"."site_admin_action" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."site_admin_action_guard"()',
    );
    expect(table()).toContain(
      'FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL',
    );
    expect(table()).toContain(
      'FOREIGN KEY ("targetUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL',
    );
  });

  it.each([...KEYED_LOGS])(
    'gives %s an idempotency key, unique where set',
    name => {
      expect(declared(KEYED_ENTITIES[name])).toContain('idempotencyKey');
      expect(up).toContain(
        `ALTER TABLE "sto_info_app"."${name}" ADD "idempotencyKey" varchar(200)`,
      );
      expect(up).toContain(
        `CREATE UNIQUE INDEX "UX_${name}_idempotency" ON "sto_info_app"."${name}" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`,
      );
    },
  );

  it('keys every log whose entity has a key, and no other', () => {
    const keyed = getMetadataArgsStorage()
      .columns.filter(column => column.propertyName === 'idempotencyKey')
      .map(column => column.target);

    expect(new Set(keyed)).toEqual(new Set(Object.values(KEYED_ENTITIES)));
  });

  it('adds what the transcript job and sweep record to the chat log', () => {
    expect(up.slice(-TRANSCRIPT_OUTCOMES.length)).toEqual(
      TRANSCRIPT_OUTCOMES.map(
        value =>
          `ALTER TYPE "sto_info_app"."chat_action_kind_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      ),
    );
  });

  it('undoes it all, making the chat log’s type again without the outcomes', () => {
    const before = Object.values(ChatActionKind).filter(
      value => !TRANSCRIPT_OUTCOMES.includes(value),
    );

    expect(down[0]).toBe(
      `DELETE FROM "sto_info_app"."chat_action" WHERE "action"::text IN (${TRANSCRIPT_OUTCOMES.map(value => `'${value}'`).join(', ')})`,
    );
    expect(down).toContain(
      `CREATE TYPE "sto_info_app"."chat_action_kind_enum" AS ENUM (${before.map(value => `'${value}'`).join(', ')})`,
    );

    for (const name of KEYED_LOGS) {
      expect(down).toContain(
        `ALTER TABLE "sto_info_app"."${name}" DROP COLUMN "idempotencyKey"`,
      );
    }

    expect(down.slice(-3)).toEqual([
      'DROP TABLE "sto_info_app"."site_admin_action"',
      'DROP FUNCTION "sto_info_app"."site_admin_action_guard"()',
      'DROP TYPE "sto_info_app"."site_admin_action_enum"',
    ]);
  });
});

/**
 * Holds the restore check's action (FC-042) to the code: added last, and
 * taken out again by a down that makes the type again without it.
 */
describe('Ledger reconciliation schema alignment (FC-042)', () => {
  const migration = new RecordLedgerReconciliation1797200000000();
  let up: string[];
  let down: string[];

  beforeAll(async () => {
    up = await capture(queryRunner => migration.up(queryRunner));
    down = await capture(queryRunner => migration.down(queryRunner));
  });

  it('adds the action the restore check logs', () => {
    expect([...LEDGER_ACTIONS]).toEqual([
      SiteAdminActionKind.LEDGERS_RECONCILED,
    ]);
    expect(up).toEqual(
      LEDGER_ACTIONS.map(
        value =>
          `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      ),
    );
  });

  // Steve's decision: the Security Log's history is not rolled back; the
  // down refuses first, with nothing changed, and says to roll forward.
  it('refuses first while the log holds the action, deleting nothing', () => {
    expect(down[0]).toContain('RAISE EXCEPTION');
    expect(LEDGER_ACTIONS_DOWN_REFUSAL).toContain('roll forward instead');
    expect(LEDGER_ACTIONS_DOWN_REFUSAL).not.toContain("'");
    expect(down.some(statement => statement.startsWith('DELETE'))).toBe(false);
  });

  it('makes the type again without it, keeping every earlier action', () => {
    // FC-042's operations actions and FC-045's feature switches come later.
    const later: readonly string[] = [
      ...LEDGER_ACTIONS,
      ...OPERATIONS_ACTIONS,
      ...FEATURE_SWITCH_ACTIONS,
    ];
    const before = Object.values(SiteAdminActionKind).filter(
      value => !later.includes(value),
    );

    expect(down).toEqual([
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM "sto_info_app"."site_admin_action" WHERE "action"::text IN ('LEDGERS_RECONCILED')) THEN RAISE EXCEPTION '${LEDGER_ACTIONS_DOWN_REFUSAL}'; END IF; END $$`,
      'ALTER TYPE "sto_info_app"."site_admin_action_enum" RENAME TO "site_admin_action_enum_old"',
      `CREATE TYPE "sto_info_app"."site_admin_action_enum" AS ENUM (${before.map(value => `'${value}'`).join(', ')})`,
      'ALTER TABLE "sto_info_app"."site_admin_action" ALTER COLUMN "action" TYPE "sto_info_app"."site_admin_action_enum" USING "action"::text::"sto_info_app"."site_admin_action_enum"',
      'DROP TYPE "sto_info_app"."site_admin_action_enum_old"',
    ]);
  });
});

/**
 * Holds the operations controls' actions (FC-042) to the code: added last,
 * and taken out again by a down that makes the type again without them.
 */
describe('Operations actions schema alignment (FC-042)', () => {
  const migration = new AddOperationsAlerts1797500000000();
  let up: string[];
  let down: string[];

  beforeAll(async () => {
    up = await capture(queryRunner => migration.up(queryRunner));
    down = await capture(queryRunner => migration.down(queryRunner));
  });

  it('adds the reads, retries, discards and pauses the site admin log records', () => {
    expect([...OPERATIONS_ACTIONS]).toEqual([
      SiteAdminActionKind.SCAN_DIAGNOSTICS_VIEWED,
      SiteAdminActionKind.SCAN_JOB_RETRIED,
      SiteAdminActionKind.PUBLICATION_PAUSED,
      SiteAdminActionKind.PUBLICATION_RESUMED,
      SiteAdminActionKind.SCAN_JOB_DISCARDED,
    ]);
    // FC-045's feature switches come after them.
    expect(
      Object.values(SiteAdminActionKind).slice(
        -OPERATIONS_ACTIONS.length - FEATURE_SWITCH_ACTIONS.length,
        -FEATURE_SWITCH_ACTIONS.length,
      ),
    ).toEqual([...OPERATIONS_ACTIONS]);
    for (const value of OPERATIONS_ACTIONS) {
      expect(up).toContain(
        `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  });

  it('makes the type again without them, keeping every earlier action', () => {
    const later: readonly string[] = [
      ...OPERATIONS_ACTIONS,
      ...FEATURE_SWITCH_ACTIONS,
    ];
    const before = Object.values(SiteAdminActionKind).filter(
      value => !later.includes(value),
    );

    expect(down).toContain(
      `CREATE TYPE "sto_info_app"."site_admin_action_enum" AS ENUM (${before.map(value => `'${value}'`).join(', ')})`,
    );
    expect(down).toContain(
      'ALTER TABLE "sto_info_app"."site_admin_action" ALTER COLUMN "action" TYPE "sto_info_app"."site_admin_action_enum" USING "action"::text::"sto_info_app"."site_admin_action_enum"',
    );
  });
});

/**
 * Holds the feature switches' actions (FC-045) to the code: added last, and
 * taken out again only by a down that refuses first while the log holds one.
 */
describe('Feature switch actions schema alignment (FC-045)', () => {
  const migration = new RecordFeatureSwitchChanges1797700000000();
  let up: string[];
  let down: string[];

  beforeAll(async () => {
    up = await capture(queryRunner => migration.up(queryRunner));
    down = await capture(queryRunner => migration.down(queryRunner));
  });

  it('adds switching a feature on and off, last', () => {
    expect([...FEATURE_SWITCH_ACTIONS]).toEqual([
      SiteAdminActionKind.FEATURE_SWITCHED_ON,
      SiteAdminActionKind.FEATURE_SWITCHED_OFF,
    ]);
    expect(
      Object.values(SiteAdminActionKind).slice(-FEATURE_SWITCH_ACTIONS.length),
    ).toEqual([...FEATURE_SWITCH_ACTIONS]);
    expect(up).toEqual(
      FEATURE_SWITCH_ACTIONS.map(
        value =>
          `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      ),
    );
  });

  it('refuses first while the log holds either action, deleting nothing', () => {
    expect(down[0]).toBe(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM "sto_info_app"."site_admin_action" WHERE "action"::text IN ('FEATURE_SWITCHED_ON', 'FEATURE_SWITCHED_OFF')) THEN RAISE EXCEPTION '${FEATURE_SWITCH_ACTIONS_DOWN_REFUSAL}'; END IF; END $$`,
    );
    expect(FEATURE_SWITCH_ACTIONS_DOWN_REFUSAL).toContain(
      'roll forward instead',
    );
    expect(FEATURE_SWITCH_ACTIONS_DOWN_REFUSAL).not.toContain("'");
    expect(down.some(statement => statement.startsWith('DELETE'))).toBe(false);
  });

  it('makes the type again without them, keeping every earlier action', () => {
    const before = Object.values(SiteAdminActionKind).filter(
      value => !(FEATURE_SWITCH_ACTIONS as readonly string[]).includes(value),
    );

    expect(down.slice(1)).toEqual([
      'ALTER TYPE "sto_info_app"."site_admin_action_enum" RENAME TO "site_admin_action_enum_old"',
      `CREATE TYPE "sto_info_app"."site_admin_action_enum" AS ENUM (${before.map(value => `'${value}'`).join(', ')})`,
      'ALTER TABLE "sto_info_app"."site_admin_action" ALTER COLUMN "action" TYPE "sto_info_app"."site_admin_action_enum" USING "action"::text::"sto_info_app"."site_admin_action_enum"',
      'DROP TYPE "sto_info_app"."site_admin_action_enum_old"',
    ]);
  });
});
