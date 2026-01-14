import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateRefreshTokenSchema1768399028214 implements MigrationInterface {
  name = 'UpdateRefreshTokenSchema1768399028214';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_rank" DROP CONSTRAINT "FK_character_rank_faction"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_refresh_token" DROP CONSTRAINT "FK_9e2418637bd2ee8d14c7ccb1e34"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_refresh_token" ALTER COLUMN "tokenId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_refresh_token" ADD CONSTRAINT "UQ_e0a1054155651a855545a270d3a" UNIQUE ("jwtId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_refresh_token" ALTER COLUMN "userId" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e0a1054155651a855545a270d3" ON "sto_info_app"."user_refresh_token" ("jwtId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9e2418637bd2ee8d14c7ccb1e3" ON "sto_info_app"."user_refresh_token" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_refresh_token" ADD CONSTRAINT "FK_9e2418637bd2ee8d14c7ccb1e34" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_rank" ADD CONSTRAINT "FK_58a3f2f865032186b258c38ba6e" FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_rank" DROP CONSTRAINT "FK_58a3f2f865032186b258c38ba6e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_refresh_token" DROP CONSTRAINT "FK_9e2418637bd2ee8d14c7ccb1e34"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_9e2418637bd2ee8d14c7ccb1e3"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_e0a1054155651a855545a270d3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_refresh_token" ALTER COLUMN "userId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_refresh_token" DROP CONSTRAINT "UQ_e0a1054155651a855545a270d3a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_refresh_token" ALTER COLUMN "tokenId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user_refresh_token" ADD CONSTRAINT "FK_9e2418637bd2ee8d14c7ccb1e34" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_rank" ADD CONSTRAINT "FK_character_rank_faction" FOREIGN KEY ("factionId") REFERENCES "sto_info_app"."character_faction"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
