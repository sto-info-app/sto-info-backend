import { MigrationInterface, QueryRunner } from "typeorm";

export class Initial1739748306217 implements MigrationInterface {
    name = 'Initial1739748306217'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "sto_info_app"."platform" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(50) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_b9b57ec16b9c2ac927aa62b8b3f" UNIQUE ("name"), CONSTRAINT "PK_c33d6abeebd214bd2850bfd6b8e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "sto_info_app"."platform_launcher" ("platformId" uuid NOT NULL, "launcherId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_222236aef081a5040e611bfe5fd" PRIMARY KEY ("platformId", "launcherId"))`);
        await queryRunner.query(`CREATE TABLE "sto_info_app"."launcher" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(50) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_09626385c9856d8c9928a386361" UNIQUE ("name"), CONSTRAINT "PK_646d34bb6c1c1ee694d16c4d5d0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "sto_info_app"."account" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "handle" character varying(255) NOT NULL, "username" character varying(255), "email" character varying(255), "notes" text, "accountCreatedDate" TIMESTAMP NOT NULL, "publiclyVisible" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "platformId" uuid, "launcherId" uuid, "userId" uuid, CONSTRAINT "PK_54115ee388cdb6d86bb4bf5b2ea" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "sto_info_app"."user_refresh_token" ("id" SERIAL NOT NULL, "tokenId" character varying NOT NULL, "jwtId" character varying NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "isRevoked" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "userId" uuid, CONSTRAINT "UQ_4412ab511de1197b4aab52444bf" UNIQUE ("tokenId"), CONSTRAINT "PK_2f86bb87603956e017efa2e74ec" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "sto_info_app"."user" ("id" uuid NOT NULL, "email" character varying(255) NOT NULL, "password" character varying(255) NOT NULL, "emailVerified" boolean NOT NULL DEFAULT false, "emailVerificationToken" character varying, "emailVerificationTokenExpiry" TIMESTAMP, "lastLoginAt" TIMESTAMP, "lastPasswordReset" TIMESTAMP, "passwordResetToken" character varying, "passwordResetTokenExpiry" TIMESTAMP, "isAccountDisabled" boolean NOT NULL DEFAULT false, "provider" character varying, "providerId" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"), CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "sto_info_app"."user_profile" ("userId" uuid NOT NULL, "username" character varying(50) NOT NULL, "firstName" character varying(255), "lastName" character varying(255), "profilePicture" character varying, "publiclyVisible" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_622345c51168e12eba4225a0217" UNIQUE ("username"), CONSTRAINT "UQ_622345c51168e12eba4225a0217" UNIQUE ("username"), CONSTRAINT "PK_51cb79b5555effaf7d69ba1cff9" PRIMARY KEY ("userId"))`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."platform_launcher" ADD CONSTRAINT "FK_99885be9f633205e2cd20a718f5" FOREIGN KEY ("platformId") REFERENCES "sto_info_app"."platform"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."platform_launcher" ADD CONSTRAINT "FK_7c1d246097e62004dbad3a5976f" FOREIGN KEY ("launcherId") REFERENCES "sto_info_app"."launcher"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" ADD CONSTRAINT "FK_3f8e13cf1fdfb5ec8887005c740" FOREIGN KEY ("platformId") REFERENCES "sto_info_app"."platform"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" ADD CONSTRAINT "FK_a8df57a8c90742552ab7d2fb2b3" FOREIGN KEY ("launcherId") REFERENCES "sto_info_app"."launcher"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" ADD CONSTRAINT "FK_60328bf27019ff5498c4b977421" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."user_refresh_token" ADD CONSTRAINT "FK_9e2418637bd2ee8d14c7ccb1e34" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."user_profile" ADD CONSTRAINT "FK_51cb79b5555effaf7d69ba1cff9" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "sto_info_app"."user_profile" DROP CONSTRAINT "FK_51cb79b5555effaf7d69ba1cff9"`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."user_refresh_token" DROP CONSTRAINT "FK_9e2418637bd2ee8d14c7ccb1e34"`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" DROP CONSTRAINT "FK_60328bf27019ff5498c4b977421"`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" DROP CONSTRAINT "FK_a8df57a8c90742552ab7d2fb2b3"`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."account" DROP CONSTRAINT "FK_3f8e13cf1fdfb5ec8887005c740"`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."platform_launcher" DROP CONSTRAINT "FK_7c1d246097e62004dbad3a5976f"`);
        await queryRunner.query(`ALTER TABLE "sto_info_app"."platform_launcher" DROP CONSTRAINT "FK_99885be9f633205e2cd20a718f5"`);
        await queryRunner.query(`DROP TABLE "sto_info_app"."user_profile"`);
        await queryRunner.query(`DROP TABLE "sto_info_app"."user"`);
        await queryRunner.query(`DROP TABLE "sto_info_app"."user_refresh_token"`);
        await queryRunner.query(`DROP TABLE "sto_info_app"."account"`);
        await queryRunner.query(`DROP TABLE "sto_info_app"."launcher"`);
        await queryRunner.query(`DROP TABLE "sto_info_app"."platform_launcher"`);
        await queryRunner.query(`DROP TABLE "sto_info_app"."platform"`);
    }

}
