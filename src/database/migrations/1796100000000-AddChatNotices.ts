import { MigrationInterface, QueryRunner } from 'typeorm';

/** The outbox's kinds before this migration. */
const PREVIOUS_KINDS = [
  'EVENT_REMINDER',
  'EVENT_CANCELLED',
  'EVENT_MOVED',
  'EVENT_PROMOTED',
  'ROSTER_ASSOCIATION_PROPOSED',
];

/** The kinds this migration adds (FC-033). */
const ADDED_KINDS = ['CHAT_MENTION', 'CHAT_REPLY', 'CHAT_DIRECT_MESSAGE'];

/**
 * Chat's notices (FC-033).
 *
 * With Steve's decisions of 28 and 29 September 2026: a mention and a reply
 * each send one notice, and a direct message sends one per conversation
 * while its reader has no chat open — no more until they open it again. The
 * outbox gains the three kinds, and each conversation records, for each of
 * its two, when they were last told: null means the next message may tell
 * them.
 */
export class AddChatNotices1796100000000 implements MigrationInterface {
  name = 'AddChatNotices1796100000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const kind of ADDED_KINDS) {
      await queryRunner.query(
        `ALTER TYPE "sto_info_app"."notification_outbox_kind_enum" ADD VALUE IF NOT EXISTS '${kind}'`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."chat_direct_conversation" ADD "lowNoticedAt" timestamptz, ADD "highNoticedAt" timestamptz`,
    );
  }

  /**
   * Reverts the migration. Chat notices still waiting go, since the earlier
   * type cannot name them; PostgreSQL cannot take a value out of a type, so
   * the type is made again without them.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const added = ADDED_KINDS.map(value => `'${value}'`).join(', ');
    const previous = PREVIOUS_KINDS.map(value => `'${value}'`).join(', ');

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."chat_direct_conversation" DROP COLUMN "highNoticedAt", DROP COLUMN "lowNoticedAt"`,
    );
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."notification_outbox" WHERE "kind"::text IN (${added})`,
    );
    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."notification_outbox_kind_enum" RENAME TO "notification_outbox_kind_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."notification_outbox_kind_enum" AS ENUM (${previous})`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."notification_outbox" ALTER COLUMN "kind" TYPE "sto_info_app"."notification_outbox_kind_enum" USING "kind"::text::"sto_info_app"."notification_outbox_kind_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."notification_outbox_kind_enum_old"`,
    );
  }
}
