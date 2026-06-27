import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNewsPost1775300100000 implements MigrationInterface {
  name = 'CreateNewsPost1775300100000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."news_category_enum" AS ENUM ('RELEASE_NOTES', 'ANNOUNCEMENT', 'GENERAL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."news_status_enum" AS ENUM ('DRAFT', 'PUBLISHED')`,
    );

    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."news_post" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "slug" character varying(280) NOT NULL,
        "title" character varying(200) NOT NULL,
        "summary" character varying(500),
        "body" text NOT NULL,
        "category" "sto_info_app"."news_category_enum" NOT NULL DEFAULT 'GENERAL',
        "status" "sto_info_app"."news_status_enum" NOT NULL DEFAULT 'DRAFT',
        "publishedAt" TIMESTAMP,
        "authorId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_news_post" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_news_post_slug" ON "sto_info_app"."news_post" ("slug")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_news_post_status" ON "sto_info_app"."news_post" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_news_post_published_at" ON "sto_info_app"."news_post" ("publishedAt")`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IX_news_post_published_at"`,
    );
    await queryRunner.query(`DROP INDEX "sto_info_app"."IX_news_post_status"`);
    await queryRunner.query(`DROP INDEX "sto_info_app"."UX_news_post_slug"`);
    await queryRunner.query(`DROP TABLE "sto_info_app"."news_post"`);
    await queryRunner.query(`DROP TYPE "sto_info_app"."news_status_enum"`);
    await queryRunner.query(`DROP TYPE "sto_info_app"."news_category_enum"`);
  }
}
