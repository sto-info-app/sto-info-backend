import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStorytimePolicyTerms1789800000000 implements MigrationInterface {
  name = 'AddStorytimePolicyTerms1789800000000';

  /**
   * Applies the migration to the database.
   *
   * Brings the schema into line with the published Storytime documents.
   *
   * Two report reasons are added because the Content Policy forbids two things
   * no existing category covers: generative-AI Story prose (§9) and commercial
   * use of the service (§3, §18). Without them a reader who spots either has
   * to choose "something else", which buries a stated prohibition in the one
   * bucket the queue cannot filter on.
   *
   * The enum is rebuilt rather than extended with `ALTER TYPE ... ADD VALUE`.
   * Postgres cannot remove a value from an enum, so an extended type would
   * leave `down` unable to do anything, and a migration that cannot be
   * reversed is one nobody dares run.
   *
   * `contentPolicyVersion` records which wording a creator agreed to rather
   * than only when they agreed. The Terms reserve the right to require fresh
   * acceptance after a material change (§25), and a bare date cannot answer
   * "did they accept the version that forbids this?".
   *
   * Existing acceptances are backfilled to the pre-versioning marker, not to
   * the current version. They were given against placeholder wording that
   * stood in for these documents, so treating them as current would hold
   * creators to terms they were never shown.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      ALTER TYPE "sto_info_app"."storytime_report_reason_enum"
      RENAME TO "storytime_report_reason_enum_old"
    `,
      `
      CREATE TYPE "sto_info_app"."storytime_report_reason_enum" AS ENUM (
        'HARASSMENT', 'HATE_CONTENT', 'EXPLICIT_CONTENT', 'GRAPHIC_VIOLENCE',
        'PLAGIARISM', 'IMPERSONATION', 'PERSONAL_INFORMATION', 'COPYRIGHT',
        'SPAM', 'MALICIOUS_LINK', 'DECEPTIVE_MEDIA', 'AI_GENERATED_CONTENT',
        'COMMERCIAL_CONTENT', 'OTHER'
      )
    `,
      `
      ALTER TABLE "sto_info_app"."storytime_report"
      ALTER COLUMN "reasonCode" TYPE "sto_info_app"."storytime_report_reason_enum"
      USING "reasonCode"::text::"sto_info_app"."storytime_report_reason_enum"
    `,
      `DROP TYPE "sto_info_app"."storytime_report_reason_enum_old"`,

      `
      ALTER TABLE "sto_info_app"."storytime_story"
      ADD COLUMN "contentPolicyVersion" character varying(20)
    `,
      `
      UPDATE "sto_info_app"."storytime_story"
      SET "contentPolicyVersion" = '0'
      WHERE "contentPolicyAcceptedAt" IS NOT NULL
    `,
    ]);
  }

  /**
   * Reverts the migration from the database.
   *
   * Reports citing a reason this migration introduced are rewritten to
   * `OTHER` before the enum narrows. They cannot be preserved — the value
   * ceases to exist — and dropping the rows would destroy a reader's complaint
   * to tidy up a type, so the report survives with its written description
   * intact and only its category coarsened.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      ALTER TABLE "sto_info_app"."storytime_story"
      DROP COLUMN "contentPolicyVersion"
    `,

      `
      UPDATE "sto_info_app"."storytime_report"
      SET "reasonCode" = 'OTHER'
      WHERE "reasonCode" IN ('AI_GENERATED_CONTENT', 'COMMERCIAL_CONTENT')
    `,
      `
      ALTER TYPE "sto_info_app"."storytime_report_reason_enum"
      RENAME TO "storytime_report_reason_enum_new"
    `,
      `
      CREATE TYPE "sto_info_app"."storytime_report_reason_enum" AS ENUM (
        'HARASSMENT', 'HATE_CONTENT', 'EXPLICIT_CONTENT', 'GRAPHIC_VIOLENCE',
        'PLAGIARISM', 'IMPERSONATION', 'PERSONAL_INFORMATION', 'COPYRIGHT',
        'SPAM', 'MALICIOUS_LINK', 'DECEPTIVE_MEDIA', 'OTHER'
      )
    `,
      `
      ALTER TABLE "sto_info_app"."storytime_report"
      ALTER COLUMN "reasonCode" TYPE "sto_info_app"."storytime_report_reason_enum"
      USING "reasonCode"::text::"sto_info_app"."storytime_report_reason_enum"
    `,
      `DROP TYPE "sto_info_app"."storytime_report_reason_enum_new"`,
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
