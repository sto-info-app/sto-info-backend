import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformLauncherBackgroundImageUrl1775200000000 implements MigrationInterface {
  name = 'PlatformLauncherBackgroundImageUrl1775200000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" ADD "id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "sto_info_app"."platform_launcher" SET "id" = uuid_generate_v4() WHERE "id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" ALTER COLUMN "id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" DROP CONSTRAINT "PK_222236aef081a5040e611bfe5fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" ADD CONSTRAINT "PK_platform_launcher_id" PRIMARY KEY ("id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" ALTER COLUMN "platformId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" ALTER COLUMN "launcherId" DROP NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" ADD "backgroundImageUrl" character varying(511)`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_platform_launcher_platform_launcher_nn" ON "sto_info_app"."platform_launcher" ("platformId", "launcherId") WHERE "platformId" IS NOT NULL AND "launcherId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_platform_launcher_platform_default" ON "sto_info_app"."platform_launcher" ("platformId") WHERE "platformId" IS NOT NULL AND "launcherId" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_platform_launcher_launcher_default" ON "sto_info_app"."platform_launcher" ("launcherId") WHERE "platformId" IS NULL AND "launcherId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_platform_launcher_global_default" ON "sto_info_app"."platform_launcher" ((1)) WHERE "platformId" IS NULL AND "launcherId" IS NULL`,
    );

    // Exact platform + launcher mappings
    await queryRunner.query(`
      UPDATE "sto_info_app"."platform_launcher" pl
      SET "backgroundImageUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/f7f4c0dc-6137-481d-86b9-d96b74737600/public'
      FROM "sto_info_app"."platform" p, "sto_info_app"."launcher" l
      WHERE p."name" = 'Windows'
        AND l."name" = 'Arc'
        AND pl."platformId" = p."id"
        AND pl."launcherId" = l."id"
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."platform_launcher" pl
      SET "backgroundImageUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/65f8c1b1-72cc-4de0-21cc-74791b6f3900/public'
      FROM "sto_info_app"."platform" p, "sto_info_app"."launcher" l
      WHERE p."name" = 'Windows'
        AND l."name" = 'Epic'
        AND pl."platformId" = p."id"
        AND pl."launcherId" = l."id"
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."platform_launcher" pl
      SET "backgroundImageUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/3e4517f1-6a07-4b68-bf80-710a70d8ff00/public'
      FROM "sto_info_app"."platform" p, "sto_info_app"."launcher" l
      WHERE p."name" = 'Windows'
        AND l."name" = 'Steam'
        AND pl."platformId" = p."id"
        AND pl."launcherId" = l."id"
    `);

    // Existing N/A launcher mappings
    await queryRunner.query(`
      UPDATE "sto_info_app"."platform_launcher" pl
      SET "backgroundImageUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/4730a67a-1277-4cec-0792-7d858d875d00/public'
      FROM "sto_info_app"."platform" p, "sto_info_app"."launcher" l
      WHERE p."name" = 'Windows'
        AND l."name" = 'N/A'
        AND pl."platformId" = p."id"
        AND pl."launcherId" = l."id"
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."platform_launcher" pl
      SET "backgroundImageUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/4a3443c5-1430-4139-0167-3eb19d135a00/public'
      FROM "sto_info_app"."platform" p, "sto_info_app"."launcher" l
      WHERE p."name" = 'PlayStation'
        AND l."name" = 'N/A'
        AND pl."platformId" = p."id"
        AND pl."launcherId" = l."id"
    `);
    await queryRunner.query(`
      UPDATE "sto_info_app"."platform_launcher" pl
      SET "backgroundImageUrl" = 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/df1a3c6f-25bd-4bfc-4541-8a4b097a9e00/public'
      FROM "sto_info_app"."platform" p, "sto_info_app"."launcher" l
      WHERE p."name" = 'Xbox'
        AND l."name" = 'N/A'
        AND pl."platformId" = p."id"
        AND pl."launcherId" = l."id"
    `);

    // Platform defaults (launcherId is null)
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."platform_launcher" ("id", "platformId", "launcherId", "backgroundImageUrl", "createdAt", "updatedAt")
      SELECT uuid_generate_v4(), p."id", NULL, 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/4730a67a-1277-4cec-0792-7d858d875d00/public', now(), now()
      FROM "sto_info_app"."platform" p
      WHERE p."name" = 'Windows'
        AND NOT EXISTS (
          SELECT 1 FROM "sto_info_app"."platform_launcher" pl
          WHERE pl."platformId" = p."id" AND pl."launcherId" IS NULL
        )
    `);
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."platform_launcher" ("id", "platformId", "launcherId", "backgroundImageUrl", "createdAt", "updatedAt")
      SELECT uuid_generate_v4(), p."id", NULL, 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/4a3443c5-1430-4139-0167-3eb19d135a00/public', now(), now()
      FROM "sto_info_app"."platform" p
      WHERE p."name" = 'PlayStation'
        AND NOT EXISTS (
          SELECT 1 FROM "sto_info_app"."platform_launcher" pl
          WHERE pl."platformId" = p."id" AND pl."launcherId" IS NULL
        )
    `);
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."platform_launcher" ("id", "platformId", "launcherId", "backgroundImageUrl", "createdAt", "updatedAt")
      SELECT uuid_generate_v4(), p."id", NULL, 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/df1a3c6f-25bd-4bfc-4541-8a4b097a9e00/public', now(), now()
      FROM "sto_info_app"."platform" p
      WHERE p."name" = 'Xbox'
        AND NOT EXISTS (
          SELECT 1 FROM "sto_info_app"."platform_launcher" pl
          WHERE pl."platformId" = p."id" AND pl."launcherId" IS NULL
        )
    `);

    // Global default (platformId and launcherId are null)
    await queryRunner.query(`
      INSERT INTO "sto_info_app"."platform_launcher" ("id", "platformId", "launcherId", "backgroundImageUrl", "createdAt", "updatedAt")
      SELECT uuid_generate_v4(), NULL, NULL, 'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/8ab52131-6f11-408a-d9df-3c1acaa46d00/public', now(), now()
      WHERE NOT EXISTS (
        SELECT 1 FROM "sto_info_app"."platform_launcher" pl
        WHERE pl."platformId" IS NULL AND pl."launcherId" IS NULL
      )
    `);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."platform_launcher" WHERE "platformId" IS NULL OR "launcherId" IS NULL`,
    );

    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_platform_launcher_global_default"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_platform_launcher_launcher_default"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_platform_launcher_platform_default"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_platform_launcher_platform_launcher_nn"`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" DROP COLUMN "backgroundImageUrl"`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" DROP CONSTRAINT "PK_platform_launcher_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" ADD CONSTRAINT "PK_222236aef081a5040e611bfe5fd" PRIMARY KEY ("platformId", "launcherId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" ALTER COLUMN "platformId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" ALTER COLUMN "launcherId" SET NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."platform_launcher" DROP COLUMN "id"`,
    );
  }
}
