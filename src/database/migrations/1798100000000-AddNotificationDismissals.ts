import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a user delete a notification from their own inbox.
 *
 * A notification is one row, shared by everyone for a broadcast or addressed
 * to one user, and its read state is already kept per reader in
 * `notification_read` rather than on the row. Deleting works the same way: a
 * row here says this reader has dismissed this notification, and the inbox,
 * its count and its unread count leave it out for that reader alone. The
 * notification stays for every other recipient and for the admin list.
 *
 * The pair is unique, so deleting twice records nothing new, and the row
 * goes with the notification if an admin deletes that outright.
 */
export class AddNotificationDismissals1798100000000 implements MigrationInterface {
  name = 'AddNotificationDismissals1798100000000';

  /**
   * Creates the table.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."notification_dismissal" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "notificationId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "dismissedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_dismissal" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_notification_dismissal_notification_user" ON "sto_info_app"."notification_dismissal" ("notificationId", "userId")`,
    );
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."notification_dismissal"
      ADD CONSTRAINT "FK_notification_dismissal_notification"
      FOREIGN KEY ("notificationId")
      REFERENCES "sto_info_app"."notification"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  /**
   * Drops the table, and with it every deletion anybody made.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."notification_dismissal" DROP CONSTRAINT "FK_notification_dismissal_notification"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_notification_dismissal_notification_user"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."notification_dismissal"`,
    );
  }
}
