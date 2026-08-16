import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorytimeChapterMedia1788400000000 implements MigrationInterface {
  name = 'CreateStorytimeChapterMedia1788400000000';

  /**
   * Applies the migration to the database.
   *
   * Adds `storytime_chapter_media`, the videos a Chapter embeds.
   *
   * Media is stored as a provider and an identifier, never as embed markup. A
   * creator pastes a share URL, the server recovers the video ID from it, and
   * the page is built from that — so no creator-supplied HTML or URL ever
   * reaches a reader's browser. There is deliberately no column an iframe
   * could be put in.
   *
   * The offsets carry check constraints because a negative start or an end
   * before its start would produce an embed URL that either fails or plays
   * something nobody asked for.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."storytime_media_provider_enum"
      AS ENUM ('YOUTUBE')
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_chapter_media" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "chapterId" uuid NOT NULL,
        "provider" "sto_info_app"."storytime_media_provider_enum" NOT NULL DEFAULT 'YOUTUBE',
        "externalId" character varying(100) NOT NULL,
        "playlistId" character varying(100),
        "startSeconds" integer,
        "endSeconds" integer,
        "title" character varying(200),
        "caption" character varying(1000),
        "orderIndex" integer NOT NULL DEFAULT 0,
        "isPrimary" boolean NOT NULL DEFAULT false,
        "createdByUserId" uuid NOT NULL,
        "updatedByUserId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_storytime_chapter_media" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_storytime_chapter_media_order_index" CHECK ("orderIndex" >= 0),
        CONSTRAINT "CHK_storytime_chapter_media_start_seconds"
          CHECK ("startSeconds" IS NULL OR "startSeconds" >= 0),
        CONSTRAINT "CHK_storytime_chapter_media_end_seconds"
          CHECK ("endSeconds" IS NULL OR "endSeconds" > "startSeconds"),
        CONSTRAINT "FK_storytime_chapter_media_chapter" FOREIGN KEY ("chapterId")
          REFERENCES "sto_info_app"."storytime_chapter" ("id") ON DELETE CASCADE
      )
    `,

      // The index behind a Chapter's media list, which the reader page loads
      // alongside the Chapter itself.
      `
      CREATE INDEX "IDX_storytime_chapter_media_listing"
      ON "sto_info_app"."storytime_chapter_media" ("chapterId", "orderIndex")
      WHERE "deletedAt" IS NULL
    `,

      // The same video may legitimately appear twice in a Chapter at different
      // offsets — a scene and its outtake — so uniqueness is per position
      // rather than per video.
      `
      CREATE UNIQUE INDEX "UQ_storytime_chapter_media_order"
      ON "sto_info_app"."storytime_chapter_media" ("chapterId", "orderIndex")
      WHERE "deletedAt" IS NULL
    `,
    ]);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `DROP TABLE "sto_info_app"."storytime_chapter_media"`,
      `DROP TYPE "sto_info_app"."storytime_media_provider_enum"`,
    ]);
  }

  /**
   * Executes migration queries in the given order.
   *
   * @param queryRunner - The TypeORM query runner.
   * @param queries - SQL statements to execute.
   */
  private async executeQueries(
    queryRunner: QueryRunner,
    queries: string[],
  ): Promise<void> {
    for (const query of queries) {
      await queryRunner.query(query);
    }
  }
}
