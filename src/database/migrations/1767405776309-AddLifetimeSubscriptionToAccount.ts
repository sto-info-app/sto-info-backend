import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLifetimeSubscriptionToAccount1767405776309 implements MigrationInterface {
    name = 'AddLifetimeSubscriptionToAccount1767405776309'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" ADD "lifetimeSubscription" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" DROP CONSTRAINT "FK_60328bf27019ff5498c4b977421"`);
        await queryRunner.query(`DROP INDEX "sto_info_app"."UX_account_user_handle_normalized"`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" ALTER COLUMN "userId" SET NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UX_account_user_handle_normalized" ON "sto_info_app"."account" ("userId", "handleNormalized") WHERE "deletedAt" IS NULL`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" ADD CONSTRAINT "FK_60328bf27019ff5498c4b977421" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" DROP CONSTRAINT "FK_60328bf27019ff5498c4b977421"`);
        await queryRunner.query(`DROP INDEX "sto_info_app"."UX_account_user_handle_normalized"`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" ALTER COLUMN "userId" DROP NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UX_account_user_handle_normalized" ON "sto_info_app"."account" ("handleNormalized", "userId") WHERE ("deletedAt" IS NULL)`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" ADD CONSTRAINT "FK_60328bf27019ff5498c4b977421" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" DROP COLUMN "lifetimeSubscription"`);
    }

}
