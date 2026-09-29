import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateChat1796000000000 } from '../../../database/migrations/1796000000000-CreateChat';
import { AddChatNotices1796100000000 } from '../../../database/migrations/1796100000000-AddChatNotices';
import { AddChatTranscriptsAndReports1796200000000 } from '../../../database/migrations/1796200000000-AddChatTranscriptsAndReports';
import {
  ChatActionKind,
  ChatChannelKind,
  ChatTranscriptStatus,
} from '../enums/chat.enums';
import { ChatActionEntity } from './chat-action.entity';
import { ChatChannelEntity } from './chat-channel.entity';
import { ChatDirectConversationEntity } from './chat-direct-conversation.entity';
import { ChatMessageReportEntity } from './chat-message-report.entity';
import { ChatMessageEntity } from './chat-message.entity';
import { ChatReportEvidenceEntity } from './chat-report-evidence.entity';
import { ChatTranscriptEntity } from './chat-transcript.entity';

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
 * Holds the chat entities and their hand-written migration to each other
 * (FC-031). It proves the two descriptions agree, not that PostgreSQL
 * accepts either: the constraints, the ceiling's trigger and the write-once
 * guard were rehearsed against the local database, with six creations at
 * once.
 */
describe('Chat schema alignment', () => {
  const migration = new CreateChat1796000000000();
  const notices = new AddChatNotices1796100000000();
  const safety = new AddChatTranscriptsAndReports1796200000000();
  let statements: string[];
  let reverted: string[];
  let noticesAdded: string[];
  let noticesReverted: string[];
  let safetyAdded: string[];
  let safetyReverted: string[];

  beforeAll(async () => {
    statements = await capture(queryRunner => migration.up(queryRunner));
    reverted = await capture(queryRunner => migration.down(queryRunner));
    noticesAdded = await capture(queryRunner => notices.up(queryRunner));
    noticesReverted = await capture(queryRunner => notices.down(queryRunner));
    safetyAdded = await capture(queryRunner => safety.up(queryRunner));
    safetyReverted = await capture(queryRunner => safety.down(queryRunner));
  });

  /**
   * The columns later migrations add to a table, as `"name" type` lines.
   *
   * @param name - The table.
   * @returns Each added column.
   */
  const addedTo = (name: string): string[] =>
    noticesAdded
      .filter(statement =>
        statement.startsWith(`ALTER TABLE "sto_info_app"."${name}" ADD`),
      )
      .flatMap(statement =>
        [...statement.matchAll(/ADD ("\w+" \w+)/g)].map(match => match[1]),
      );

  const table = (name: string): string =>
    [...statements, ...safetyAdded].find(statement =>
      statement.includes(`CREATE TABLE "sto_info_app"."${name}" (`),
    ) as string;

  const sqlLines = (name: string): string[] => [
    ...table(name)
      .split('\n')
      .map(line => line.trim()),
    ...addedTo(name),
  ];

  const declared = (target: unknown) =>
    getMetadataArgsStorage().columns.filter(column => column.target === target);

  describe.each([
    ['chat_channel', ChatChannelEntity],
    ['chat_direct_conversation', ChatDirectConversationEntity],
    ['chat_message', ChatMessageEntity],
    ['chat_action', ChatActionEntity],
    ['chat_transcript', ChatTranscriptEntity],
    ['chat_message_report', ChatMessageReportEntity],
    ['chat_report_evidence', ChatReportEvidenceEntity],
  ])('%s', (name, entity) => {
    it('declares exactly the columns the table is created with', () => {
      const migrationColumns = sqlLines(name)
        .filter(line => line.startsWith('"'))
        .map(line => line.slice(1, line.indexOf('"', 1)));

      // FC-039's migration adds the idempotency key; its spec holds that.
      expect([...migrationColumns].sort()).toEqual(
        declared(entity)
          .map(column => column.propertyName)
          .filter(column => column !== 'idempotencyKey')
          .sort(),
      );
    });

    it('types every instant column as timestamptz in both places', () => {
      const instants = declared(entity).filter(
        each => each.options.type === 'timestamptz',
      );

      expect(instants.length).toBeGreaterThan(0);

      for (const column of instants) {
        expect(sqlLines(name)).toContainEqual(
          expect.stringMatching(
            new RegExp(`^"${column.propertyName}" timestamptz(?![a-z])`),
          ),
        );
      }
    });
  });

  /**
   * The values a type is created with, and those later added to it.
   *
   * @param name - The type.
   * @returns Every value, in order.
   */
  const valuesOf = (name: string): string[] => {
    const all = [...statements, ...safetyAdded];
    const created = all.find(statement =>
      statement.startsWith(`CREATE TYPE "sto_info_app"."${name}" AS ENUM (`),
    ) as string;
    const added = all
      .filter(statement =>
        statement.startsWith(`ALTER TYPE "sto_info_app"."${name}" ADD VALUE`),
      )
      .map(statement => statement.slice(statement.lastIndexOf(' ') + 2, -1));

    return [...created.matchAll(/'(\w+)'/g)]
      .map(match => match[1])
      .concat(added);
  };

  it.each([
    ['chat_channel_kind_enum', Object.values(ChatChannelKind)],
    // FC-039's migration adds what the transcript job and sweep did; its
    // spec holds that.
    [
      'chat_action_kind_enum',
      Object.values(ChatActionKind).filter(
        value =>
          value !== ChatActionKind.TRANSCRIPT_READY &&
          value !== ChatActionKind.TRANSCRIPT_FAILED &&
          value !== ChatActionKind.TRANSCRIPT_EXPIRED,
      ),
    ],
    ['chat_transcript_status_enum', Object.values(ChatTranscriptStatus)],
  ])('makes %s hold every value the code knows', (name, values) => {
    expect(valuesOf(name)).toEqual(values);
  });

  it('bounds a transcript to seven days before it was asked for, with a purpose', () => {
    expect(table('chat_transcript')).toContain(
      `CONSTRAINT "CHK_chat_transcript_range" CHECK ("fromAt" < "toAt" AND "toAt" <= "createdAt" AND "fromAt" >= "createdAt" - interval '7 days')`,
    );
    expect(table('chat_transcript')).toContain(
      'CONSTRAINT "CHK_chat_transcript_purpose" CHECK (length(btrim("purpose")) BETWEEN 10 AND 500)',
    );
  });

  it('takes one report a person per message, and at most 21 held messages', () => {
    expect(table('chat_message_report')).toContain(
      'CONSTRAINT "UQ_chat_message_report_once" UNIQUE ("messageId", "reporterUserId")',
    );
    expect(table('chat_report_evidence')).toContain(
      'CONSTRAINT "CHK_chat_report_evidence_position" CHECK ("position" BETWEEN 0 AND 20)',
    );
    expect(table('chat_report_evidence')).toContain(
      'REFERENCES "sto_info_app"."chat_message_report"("id") ON DELETE CASCADE',
    );
  });

  it('keeps reports and evidence free of the messages they hold, so both outlive the purge', () => {
    for (const name of ['chat_message_report', 'chat_report_evidence']) {
      expect(table(name)).not.toContain('"sto_info_app"."chat_message"(');
    }
  });

  it('takes transcripts and reports back out, remaking the log’s type without them', () => {
    expect(safetyReverted).toEqual([
      'DROP TABLE "sto_info_app"."chat_report_evidence"',
      'DROP TABLE "sto_info_app"."chat_message_report"',
      'DROP TABLE "sto_info_app"."chat_transcript"',
      'DROP TYPE "sto_info_app"."chat_transcript_status_enum"',
      `DELETE FROM "sto_info_app"."chat_action" WHERE "action"::text IN ('TRANSCRIPT_REQUESTED', 'TRANSCRIPT_DOWNLOADED')`,
      'ALTER TYPE "sto_info_app"."chat_action_kind_enum" RENAME TO "chat_action_kind_enum_old"',
      `CREATE TYPE "sto_info_app"."chat_action_kind_enum" AS ENUM ('CHANNEL_CREATED', 'CHANNEL_CHANGED', 'CHANNEL_ARCHIVED', 'MESSAGE_REMOVED')`,
      'ALTER TABLE "sto_info_app"."chat_action" ALTER COLUMN "action" TYPE "sto_info_app"."chat_action_kind_enum" USING "action"::text::"sto_info_app"."chat_action_kind_enum"',
      'DROP TYPE "sto_info_app"."chat_action_kind_enum_old"',
    ]);
  });

  it('keeps one standard channel per scope, and names unique while live', () => {
    expect(statements).toContainEqual(
      expect.stringMatching(
        /^CREATE UNIQUE INDEX "UX_chat_channel_standard" .* WHERE "kind" = 'STANDARD'$/,
      ),
    );
    expect(statements).toContainEqual(
      expect.stringMatching(
        /^CREATE UNIQUE INDEX "UX_chat_channel_name" .*lower\("name"\)\) WHERE "archivedAt" IS NULL$/,
      ),
    );
  });

  it('counts custom channels under the scope’s lock, refusing a fourth', () => {
    const limit = statements.find(statement =>
      statement.includes('"chat_channel_limit"()\n'),
    ) as string;

    expect(limit).toContain('pg_advisory_xact_lock');
    expect(limit).toContain(') >= 3 THEN');
    expect(limit).toContain("USING ERRCODE = '23514'");
  });

  it('posts a message once per client ID, in exactly one place', () => {
    expect(table('chat_message')).toContain(
      'CONSTRAINT "UQ_chat_message_client" UNIQUE ("authorUserId", "clientMessageId")',
    );
    expect(table('chat_message')).toContain(
      'CONSTRAINT "CHK_chat_message_place" CHECK (("channelId" IS NULL) <> ("conversationId" IS NULL))',
    );
    expect(sqlLines('chat_message')).toContain(
      '"body" varchar(2000) NOT NULL,',
    );
  });

  it('defaults mentions to none in both places', () => {
    const mentions = declared(ChatMessageEntity).find(
      column => column.propertyName === 'mentions',
    );

    expect((mentions?.options.default as () => string)()).toBe("'{}'");
    expect(sqlLines('chat_message')).toContain(
      `"mentions" uuid[] NOT NULL DEFAULT '{}',`,
    );
  });

  it('keeps one conversation per pair, lower ID first', () => {
    expect(table('chat_direct_conversation')).toContain(
      'CONSTRAINT "CHK_chat_direct_conversation_order" CHECK ("userLowId" < "userHighId")',
    );
  });

  it('adds chat’s notice kinds to the outbox, and each person’s notice time', () => {
    expect(noticesAdded).toEqual([
      `ALTER TYPE "sto_info_app"."notification_outbox_kind_enum" ADD VALUE IF NOT EXISTS 'CHAT_MENTION'`,
      `ALTER TYPE "sto_info_app"."notification_outbox_kind_enum" ADD VALUE IF NOT EXISTS 'CHAT_REPLY'`,
      `ALTER TYPE "sto_info_app"."notification_outbox_kind_enum" ADD VALUE IF NOT EXISTS 'CHAT_DIRECT_MESSAGE'`,
      `ALTER TABLE "sto_info_app"."chat_direct_conversation" ADD "lowNoticedAt" timestamptz, ADD "highNoticedAt" timestamptz`,
    ]);
  });

  it('takes the notices back out, remaking the outbox’s type without them', () => {
    expect(noticesReverted).toEqual([
      `ALTER TABLE "sto_info_app"."chat_direct_conversation" DROP COLUMN "highNoticedAt", DROP COLUMN "lowNoticedAt"`,
      `DELETE FROM "sto_info_app"."notification_outbox" WHERE "kind"::text IN ('CHAT_MENTION', 'CHAT_REPLY', 'CHAT_DIRECT_MESSAGE')`,
      `ALTER TYPE "sto_info_app"."notification_outbox_kind_enum" RENAME TO "notification_outbox_kind_enum_old"`,
      `CREATE TYPE "sto_info_app"."notification_outbox_kind_enum" AS ENUM ('EVENT_REMINDER', 'EVENT_CANCELLED', 'EVENT_MOVED', 'EVENT_PROMOTED', 'ROSTER_ASSOCIATION_PROPOSED')`,
      `ALTER TABLE "sto_info_app"."notification_outbox" ALTER COLUMN "kind" TYPE "sto_info_app"."notification_outbox_kind_enum" USING "kind"::text::"sto_info_app"."notification_outbox_kind_enum"`,
      `DROP TYPE "sto_info_app"."notification_outbox_kind_enum_old"`,
    ]);
  });

  it('takes everything back out when reverted', () => {
    expect(reverted).toEqual([
      'DROP TABLE "sto_info_app"."chat_action"',
      'DROP FUNCTION "sto_info_app"."chat_action_guard"()',
      'DROP TABLE "sto_info_app"."chat_message"',
      'DROP TABLE "sto_info_app"."chat_direct_conversation"',
      'DROP TABLE "sto_info_app"."chat_channel"',
      'DROP FUNCTION "sto_info_app"."chat_channel_limit"()',
      'DROP TYPE "sto_info_app"."chat_action_kind_enum"',
      'DROP TYPE "sto_info_app"."chat_channel_kind_enum"',
    ]);
  });
});
