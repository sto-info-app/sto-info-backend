import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the tables holding what a user actually recorded.
 *
 * Three constraints here are doing work a service could only do less reliably.
 *
 * Target exclusivity is a check constraint: a value names an Account or a
 * Character and never both or neither. A service check would let the first bad
 * row through under a race and leave it to be found by whatever tried to
 * render it.
 *
 * Scope consistency is a composite foreign key onto the Field's own identifier
 * and scope, which needs the unique key added to the Field table here. That is
 * what refuses an Account value recorded against a Character-scoped Field —
 * not a comparison somebody remembered to write.
 *
 * One live answer per Field and target is two partial unique indexes rather
 * than one, because a null does not compare equal to anything in SQL: a single
 * index over both target columns would let the same Account be answered twice.
 */
export class CreateCustomTrackingValueTables1791200000000 implements MigrationInterface {
  name = 'CreateCustomTrackingValueTables1791200000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."custom_tracking_image_shape_enum" AS ENUM ('SQUARE', 'LANDSCAPE', 'PORTRAIT')`,
    );

    // The target of the composite foreign key below. A Field's scope never
    // changes, so this key is stable for the life of the row.
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."custom_tracking_field"
       ADD CONSTRAINT "UX_custom_tracking_field_id_scope" UNIQUE ("id", "targetScope")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."custom_tracking_value" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fieldId" uuid NOT NULL,
      "targetScope" "sto_info_app"."custom_tracking_target_scope_enum" NOT NULL,
      "accountId" uuid,
      "characterId" uuid,
      "value" jsonb,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      "deletedAt" TIMESTAMP,
      CONSTRAINT "PK_custom_tracking_value" PRIMARY KEY ("id"),
      CONSTRAINT "CK_custom_tracking_value_target" CHECK (
        ("targetScope" = 'ACCOUNT' AND "accountId" IS NOT NULL AND "characterId" IS NULL)
        OR
        ("targetScope" = 'CHARACTER' AND "characterId" IS NOT NULL AND "accountId" IS NULL)
      ),
      CONSTRAINT "FK_custom_tracking_value_field" FOREIGN KEY ("fieldId", "targetScope") REFERENCES "sto_info_app"."custom_tracking_field"("id", "targetScope") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_custom_tracking_value_account" FOREIGN KEY ("accountId") REFERENCES "sto_info_app"."account"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_custom_tracking_value_character" FOREIGN KEY ("characterId") REFERENCES "sto_info_app"."character"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_custom_tracking_value_field_account" ON "sto_info_app"."custom_tracking_value" ("fieldId", "accountId") WHERE "deletedAt" IS NULL AND "accountId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_custom_tracking_value_field_character" ON "sto_info_app"."custom_tracking_value" ("fieldId", "characterId") WHERE "deletedAt" IS NULL AND "characterId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_custom_tracking_value_account" ON "sto_info_app"."custom_tracking_value" ("accountId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_custom_tracking_value_character" ON "sto_info_app"."custom_tracking_value" ("characterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_custom_tracking_value_field" ON "sto_info_app"."custom_tracking_value" ("fieldId")`,
    );

    // ON DELETE RESTRICT, deliberately. This is the constraint that makes a
    // withdrawn option outlive its retention window for as long as a value
    // still names it, without anything having to remember to check.
    await queryRunner.query(`CREATE TABLE "sto_info_app"."custom_tracking_value_option" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "valueId" uuid NOT NULL,
      "optionId" uuid NOT NULL,
      "orderIndex" integer NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_custom_tracking_value_option" PRIMARY KEY ("id"),
      CONSTRAINT "UX_custom_tracking_value_option" UNIQUE ("valueId", "optionId"),
      CONSTRAINT "FK_custom_tracking_value_option_value" FOREIGN KEY ("valueId") REFERENCES "sto_info_app"."custom_tracking_value"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_custom_tracking_value_option_option" FOREIGN KEY ("optionId") REFERENCES "sto_info_app"."custom_tracking_option"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_custom_tracking_value_option_option" ON "sto_info_app"."custom_tracking_value_option" ("optionId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."custom_tracking_image_value" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "valueId" uuid NOT NULL,
      "cloudflareImageId" varchar(160) NOT NULL,
      "altText" varchar(300) NOT NULL,
      "shape" "sto_info_app"."custom_tracking_image_shape_enum" NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_custom_tracking_image_value" PRIMARY KEY ("id"),
      CONSTRAINT "UX_custom_tracking_image_value_value" UNIQUE ("valueId"),
      CONSTRAINT "FK_custom_tracking_image_value_value" FOREIGN KEY ("valueId") REFERENCES "sto_info_app"."custom_tracking_value"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_custom_tracking_image_value_image" ON "sto_info_app"."custom_tracking_image_value" ("cloudflareImageId")`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."custom_tracking_image_value"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."custom_tracking_value_option"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."custom_tracking_value"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."custom_tracking_field" DROP CONSTRAINT "UX_custom_tracking_field_id_scope"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."custom_tracking_image_shape_enum"`,
    );
  }
}
