import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSesEventTable1769500000000 implements MigrationInterface {
  name = 'CreateSesEventTable1769500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sto_info_app"."_audit_ses_event" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"eventType" character varying(20) NOT NULL, ` +
        // emailHashed stores a 64-char HMAC-SHA256 hex digest — never plaintext.
        `"emailHashed" character varying(64) NOT NULL, ` +
        `"bounceType" character varying(20) NULL, ` +
        `"bounceSubType" character varying(50) NULL, ` +
        `"complaintFeedbackType" character varying(50) NULL, ` +
        `"sesMessageId" character varying(200) NULL, ` +
        `"snsMessageId" character varying(200) NOT NULL, ` +
        `"suppress" boolean NOT NULL DEFAULT false, ` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK__audit_ses_event_id" PRIMARY KEY ("id"), ` +
        `CONSTRAINT "UQ__audit_ses_event_snsMessageId" UNIQUE ("snsMessageId")` +
        `)`,
    );

    // Index for O(1) suppression lookups: WHERE emailHashed = ? AND suppress = true
    await queryRunner.query(
      `CREATE INDEX "IDX__audit_ses_event_emailHashed_suppress" ` +
        `ON "sto_info_app"."_audit_ses_event" ("emailHashed", "suppress")`,
    );

    // Index for efficient date-range cleanup by the nightly cron job
    await queryRunner.query(
      `CREATE INDEX "IDX__audit_ses_event_suppress_createdAt" ` +
        `ON "sto_info_app"."_audit_ses_event" ("suppress", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX__audit_ses_event_suppress_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX__audit_ses_event_emailHashed_suppress"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."_audit_ses_event"`);
  }
}
