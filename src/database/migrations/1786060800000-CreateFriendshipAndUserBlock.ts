import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFriendshipAndUserBlock1786060800000 implements MigrationInterface {
  name = 'CreateFriendshipAndUserBlock1786060800000';

  /**
   * Applies the migration to the database.
   *
   * Adds the two tables behind community friendships: `friendship`, a directed
   * friend request that becomes a friendship once accepted, and `user_block`,
   * one member's decision to block another.
   *
   * Both tables soft-delete, so their uniqueness guarantees are partial indexes
   * scoped to live rows — cancelling a request or unblocking a member has to
   * leave the pair free to be used again.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "sto_info_app"."friendship_status_enum"
      AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED')
    `);

    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."friendship" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "requesterId" uuid NOT NULL,
        "addresseeId" uuid NOT NULL,
        "status" "sto_info_app"."friendship_status_enum" NOT NULL DEFAULT 'PENDING',
        "respondedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_friendship" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_friendship_not_self" CHECK ("requesterId" <> "addresseeId"),
        CONSTRAINT "FK_friendship_requester" FOREIGN KEY ("requesterId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_friendship_addressee" FOREIGN KEY ("addresseeId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE
      )
    `);

    // One live row per pair regardless of who asked. Ordering the two IDs
    // canonically makes the index cover A->B and B->A with a single entry, so a
    // reply-with-a-request race cannot create a duplicate friendship.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_friendship_pair"
      ON "sto_info_app"."friendship"
        (LEAST("requesterId", "addresseeId"), GREATEST("requesterId", "addresseeId"))
      WHERE "deletedAt" IS NULL
    `);

    // Supports "requests I sent" and the friend list read from the sender side.
    await queryRunner.query(`
      CREATE INDEX "IDX_friendship_requester_status"
      ON "sto_info_app"."friendship" ("requesterId", "status")
      WHERE "deletedAt" IS NULL
    `);

    // Supports "requests I received" and the friend list read from the other
    // side, which is the query behind the pending-request badge.
    await queryRunner.query(`
      CREATE INDEX "IDX_friendship_addressee_status"
      ON "sto_info_app"."friendship" ("addresseeId", "status")
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."user_block" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "blockerId" uuid NOT NULL,
        "blockedId" uuid NOT NULL,
        "reason" character varying(500),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_user_block" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_user_block_not_self" CHECK ("blockerId" <> "blockedId"),
        CONSTRAINT "FK_user_block_blocker" FOREIGN KEY ("blockerId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_block_blocked" FOREIGN KEY ("blockedId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE
      )
    `);

    // A block is one-sided, so unlike a friendship both directions are distinct
    // rows and only the exact pair needs to be unique.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_user_block_pair"
      ON "sto_info_app"."user_block" ("blockerId", "blockedId")
      WHERE "deletedAt" IS NULL
    `);

    // The registry filters on blocks in both directions on every read, so each
    // side of the pair needs its own lookup.
    await queryRunner.query(`
      CREATE INDEX "IDX_user_block_blocker"
      ON "sto_info_app"."user_block" ("blockerId")
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_user_block_blocked"
      ON "sto_info_app"."user_block" ("blockedId")
      WHERE "deletedAt" IS NULL
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sto_info_app"."user_block"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."friendship"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."friendship_status_enum"`,
    );
  }
}
