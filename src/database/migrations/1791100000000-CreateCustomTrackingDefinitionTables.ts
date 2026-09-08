import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the Custom Tracking definition hierarchy.
 *
 * Every table is new, so the migration is purely additive and safe to apply
 * ahead of the application that uses it. Nothing outside this feature is
 * touched, which is what lets the backend deploy before the interface exists.
 *
 * The uniqueness indexes are partial, covering only rows that are not
 * soft-deleted. That is what makes a name reusable after its definition has
 * been deleted while still refusing two live siblings with the same name — and
 * makes it the database's answer rather than a service check that two
 * simultaneous requests could both pass.
 */
export class CreateCustomTrackingDefinitionTables1791100000000 implements MigrationInterface {
  name = 'CreateCustomTrackingDefinitionTables1791100000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."custom_tracking_target_scope_enum" AS ENUM ('ACCOUNT', 'CHARACTER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."custom_tracking_empty_mode_enum" AS ENUM ('HIDE', 'SHOW_LABEL', 'SHOW_PLACEHOLDER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."custom_tracking_field_type_enum" AS ENUM (
        'TEXT_SINGLE_LINE', 'MARKDOWN', 'INTEGER', 'DECIMAL', 'PERCENTAGE',
        'RANGE', 'RATING', 'PROGRESS', 'DATE', 'TIME', 'DATE_TIME',
        'MONTH_YEAR', 'YEAR', 'DURATION', 'DATE_RANGE', 'DATE_TIME_RANGE',
        'TOGGLE', 'CHECKBOX', 'RADIO', 'DROPDOWN', 'CHECKBOX_LIST',
        'MULTI_SELECT', 'YES_NO_UNKNOWN', 'COLOUR', 'TAGS', 'IMAGE', 'YOUTUBE'
      )`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."custom_tracking_policy_acceptance" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "userId" uuid NOT NULL,
      "policyVersion" varchar(20) NOT NULL,
      "acceptedAt" TIMESTAMP NOT NULL,
      "policyEffectiveDate" date NOT NULL,
      "policyUpdatedDate" date NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_custom_tracking_policy_acceptance" PRIMARY KEY ("id"),
      CONSTRAINT "FK_custom_tracking_policy_acceptance_user" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_custom_tracking_policy_acceptance_user" ON "sto_info_app"."custom_tracking_policy_acceptance" ("userId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."custom_tracking_section" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "userId" uuid NOT NULL,
      "targetScope" "sto_info_app"."custom_tracking_target_scope_enum" NOT NULL,
      "name" varchar(100) NOT NULL,
      "nameNormalized" varchar(100) NOT NULL,
      "description" varchar(500),
      "orderIndex" integer NOT NULL,
      "publiclyVisible" boolean NOT NULL DEFAULT false,
      "suppressedAt" TIMESTAMP,
      "suppressedByUserId" uuid,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      "deletedAt" TIMESTAMP,
      CONSTRAINT "PK_custom_tracking_section" PRIMARY KEY ("id"),
      CONSTRAINT "FK_custom_tracking_section_user" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_custom_tracking_section_user_scope_name" ON "sto_info_app"."custom_tracking_section" ("userId", "targetScope", "nameNormalized") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_custom_tracking_section_user_scope_order" ON "sto_info_app"."custom_tracking_section" ("userId", "targetScope", "orderIndex")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."custom_tracking_tab" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "sectionId" uuid NOT NULL,
      "name" varchar(100) NOT NULL,
      "nameNormalized" varchar(100) NOT NULL,
      "description" varchar(500),
      "orderIndex" integer NOT NULL,
      "publiclyVisible" boolean NOT NULL DEFAULT false,
      "suppressedAt" TIMESTAMP,
      "suppressedByUserId" uuid,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      "deletedAt" TIMESTAMP,
      CONSTRAINT "PK_custom_tracking_tab" PRIMARY KEY ("id"),
      CONSTRAINT "FK_custom_tracking_tab_section" FOREIGN KEY ("sectionId") REFERENCES "sto_info_app"."custom_tracking_section"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_custom_tracking_tab_section_name" ON "sto_info_app"."custom_tracking_tab" ("sectionId", "nameNormalized") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_custom_tracking_tab_section_order" ON "sto_info_app"."custom_tracking_tab" ("sectionId", "orderIndex")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."custom_tracking_field" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "tabId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "targetScope" "sto_info_app"."custom_tracking_target_scope_enum" NOT NULL,
      "fieldType" "sto_info_app"."custom_tracking_field_type_enum" NOT NULL,
      "name" varchar(100) NOT NULL,
      "nameNormalized" varchar(100) NOT NULL,
      "description" varchar(500),
      "orderIndex" integer NOT NULL,
      "publiclyVisible" boolean NOT NULL DEFAULT false,
      "required" boolean NOT NULL DEFAULT false,
      "ownerEmptyMode" "sto_info_app"."custom_tracking_empty_mode_enum" NOT NULL DEFAULT 'SHOW_LABEL',
      "publicEmptyMode" "sto_info_app"."custom_tracking_empty_mode_enum" NOT NULL DEFAULT 'HIDE',
      "emptyPlaceholder" varchar(100),
      "configuration" jsonb NOT NULL,
      "defaultValue" jsonb,
      "suppressedAt" TIMESTAMP,
      "suppressedByUserId" uuid,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      "deletedAt" TIMESTAMP,
      CONSTRAINT "PK_custom_tracking_field" PRIMARY KEY ("id"),
      CONSTRAINT "FK_custom_tracking_field_tab" FOREIGN KEY ("tabId") REFERENCES "sto_info_app"."custom_tracking_tab"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_custom_tracking_field_user" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_custom_tracking_field_tab_name" ON "sto_info_app"."custom_tracking_field" ("tabId", "nameNormalized") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_custom_tracking_field_tab_order" ON "sto_info_app"."custom_tracking_field" ("tabId", "orderIndex")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_custom_tracking_field_user_scope" ON "sto_info_app"."custom_tracking_field" ("userId", "targetScope")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."custom_tracking_option" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fieldId" uuid NOT NULL,
      "label" varchar(100) NOT NULL,
      "labelNormalized" varchar(100) NOT NULL,
      "orderIndex" integer NOT NULL,
      "isDefault" boolean NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      "deletedAt" TIMESTAMP,
      CONSTRAINT "PK_custom_tracking_option" PRIMARY KEY ("id"),
      CONSTRAINT "FK_custom_tracking_option_field" FOREIGN KEY ("fieldId") REFERENCES "sto_info_app"."custom_tracking_field"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_custom_tracking_option_field_label" ON "sto_info_app"."custom_tracking_option" ("fieldId", "labelNormalized") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_custom_tracking_option_field_order" ON "sto_info_app"."custom_tracking_option" ("fieldId", "orderIndex")`,
    );

    await queryRunner.query(
      `INSERT INTO "sto_info_app"."app_setting" ("key", "value", "description")
       VALUES ('CUSTOM_TRACKING_ENABLED', 'false', 'Master switch for the Custom Tracking feature.')
       ON CONFLICT ("key") DO NOTHING`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * Dropped in the reverse of the order they were created, so no table is
   * removed while another still references it. The enum types go last, since a
   * type cannot be dropped while a column still uses it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."app_setting" WHERE "key" = 'CUSTOM_TRACKING_ENABLED'`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."custom_tracking_option"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."custom_tracking_field"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."custom_tracking_tab"`);
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."custom_tracking_section"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."custom_tracking_policy_acceptance"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."custom_tracking_field_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."custom_tracking_empty_mode_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."custom_tracking_target_scope_enum"`,
    );
  }
}
