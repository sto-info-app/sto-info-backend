import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  SES_AUDIT_RETENTION_DAYS,
  SES_SUPPRESSION_RETENTION_DAYS,
} from 'src/cron/constants/cron.constants';
import { SesEventEntity } from 'src/webhooks/ses/entities/ses-event.entity';
import { LessThan, Repository } from 'typeorm';

/**
 * Nightly cleanup job for the `audit_ses_event` table.
 *
 * @remarks
 * A two-tier retention strategy is applied:
 *
 * 1. **Non-suppressing records** (soft bounces, deliveries — `suppress = false`)
 *    are deleted after {@link SES_AUDIT_RETENTION_DAYS} days.
 *    These are purely informational and do not affect email sending behaviour.
 *
 * 2. **Suppression records** (hard bounces, complaints — `suppress = true`)
 *    are deleted after {@link SES_SUPPRESSION_RETENTION_DAYS} days.
 *    These must be kept long enough to protect the sender reputation;
 *    typically this value is set to several years.
 *
 * Because email addresses are stored only as HMAC-SHA256 hashes, deleting
 * a row is the only meaningful PII-removal action here — there is no
 * "null-out" step analogous to the `emailMasked` pattern used in
 * `audit_contact_request`.
 */
@Injectable()
export class SesAuditCleanupService {
  private readonly logger = new Logger(SesAuditCleanupService.name);

  constructor(
    @InjectRepository(SesEventEntity)
    private readonly sesEventRepository: Repository<SesEventEntity>,
  ) {}

  /**
   * Executes the two-tier cleanup:
   *
   * 1. Deletes non-suppressing records (deliveries, soft bounces) older than
   *    `SES_AUDIT_RETENTION_DAYS` days.
   * 2. Deletes suppression records (hard bounces, complaints) older than
   *    `SES_SUPPRESSION_RETENTION_DAYS` days.
   *
   * Both operations are logged with the number of affected rows for observability.
   */
  async cleanup(): Promise<void> {
    await this.deleteNonSuppressingRecords();
    await this.deleteSuppressingRecords();
  }

  /**
   * Deletes audit_ses_event rows where `suppress = false` (soft bounces and
   * deliveries) and `createdAt` is older than the configured audit retention window.
   */
  private async deleteNonSuppressingRecords(): Promise<void> {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - SES_AUDIT_RETENTION_DAYS);

    const result = await this.sesEventRepository.delete({
      suppress: false,
      createdAt: LessThan(threshold),
    });

    this.logger.log(
      `Deleted ${result.affected ?? 0} non-suppressing SES audit records older than ${SES_AUDIT_RETENTION_DAYS} days.`,
    );
  }

  /**
   * Deletes audit_ses_event rows where `suppress = true` (hard bounces and
   * complaints) and `createdAt` is older than the configured suppression
   * retention window.
   *
   * Once deleted, the address is no longer suppressed. Ensure the retention
   * window is long enough that any remaining active mailing lists have been
   * cleaned up before these records are purged.
   */
  private async deleteSuppressingRecords(): Promise<void> {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - SES_SUPPRESSION_RETENTION_DAYS);

    const result = await this.sesEventRepository.delete({
      suppress: true,
      createdAt: LessThan(threshold),
    });

    this.logger.log(
      `Deleted ${result.affected ?? 0} suppression SES audit records older than ${SES_SUPPRESSION_RETENTION_DAYS} days.`,
    );
  }
}
