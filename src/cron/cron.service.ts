import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CRON_TIMEZONE } from './constants/cron.constants';
import { AuditCleanupService } from './jobs/audit-cleanup/audit-cleanup.service';
import { AuditLoginAttemptCleanupService } from './jobs/audit-login-attempt-cleanup/audit-login-attempt-cleanup.service';
import { ContactRequestCleanupService } from './jobs/contact-request-cleanup/contact-request-cleanup.service';
import { SesAuditCleanupService } from './jobs/ses-audit-cleanup/ses-audit-cleanup.service';
import { UserAccountCleanupService } from './jobs/user-account-cleanup/user-account-cleanup.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  /**
   * Creates an instance of CronService.
   *
   * @param auditCleanupService - The audit cleanup service.
   * @param auditLoginAttemptCleanupService - The audit login attempt cleanup service.
   * @param contactRequestCleanupService - The contact request cleanup service.
   * @param sesAuditCleanupService - The ses audit cleanup service.
   * @param userAccountCleanupService - The user account cleanup service.
   */
  constructor(
    private readonly auditCleanupService: AuditCleanupService,
    private readonly auditLoginAttemptCleanupService: AuditLoginAttemptCleanupService,
    private readonly contactRequestCleanupService: ContactRequestCleanupService,
    private readonly sesAuditCleanupService: SesAuditCleanupService,
    private readonly userAccountCleanupService: UserAccountCleanupService,
  ) {}

  /**
   * Runs all nightly cleanup jobs.
   *
   * Scheduled at two times to build in redundancy:
   * - `26 3 * * *` – 03:26 UTC (off-peak, avoids midnight congestion)
   * - `CronExpression.EVERY_DAY_AT_MIDNIGHT` – 00:00 UTC (standard midnight run)
   *
   * Errors within individual jobs are caught and logged by their respective
   * handler methods so that a failure in one job does not prevent the others
   * from running.
   */
  @Cron('26 3 * * *', { timeZone: CRON_TIMEZONE })
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: CRON_TIMEZONE })
  async dailyMidnightJobs() {
    this.logger.log('Running daily midnight jobs...');
    try {
      await this.handleAuditCleanup();
      await this.handleAuditLoginAttemptCleanup();
      await this.handleContactRequestCleanup();
      await this.handleSesAuditCleanup();
      await this.handleUserAccountCleanup();
    } catch (error) {
      this.logger.error('Error running daily midnight jobs:', error);
    }
  }

  /**
   * Invokes the general audit log cleanup job and wraps it with start/end
   * log messages. Errors are logged and swallowed to allow subsequent jobs
   * to proceed.
   */
  private async handleAuditCleanup() {
    this.logger.log('Starting audit cleanup job...');
    try {
      await this.auditCleanupService.cleanup();
      this.logger.log('Audit cleanup job completed successfully.');
    } catch (error) {
      this.logger.error('Error running audit cleanup job:', error);
    }
  }

  /**
   * Invokes the audit login-attempt cleanup job and wraps it with start/end
   * log messages. Errors are logged and swallowed to allow subsequent jobs
   * to proceed.
   */
  private async handleAuditLoginAttemptCleanup() {
    this.logger.log('Starting audit login attempt cleanup job...');
    try {
      await this.auditLoginAttemptCleanupService.cleanup();
      this.logger.log(
        'Audit login attempt cleanup job completed successfully.',
      );
    } catch (error) {
      this.logger.error(
        'Error running audit login attempt cleanup job:',
        error,
      );
    }
  }

  /**
   * Invokes the contact-request cleanup job (record deletion + email-mask
   * nulling) and wraps it with start/end log messages. Errors are logged and
   * swallowed to allow subsequent jobs to proceed.
   */
  private async handleContactRequestCleanup() {
    this.logger.log('Starting contact request cleanup job...');
    try {
      await this.contactRequestCleanupService.cleanup();
      this.logger.log('Contact request cleanup job completed successfully.');
    } catch (error) {
      this.logger.error('Error running contact request cleanup job:', error);
    }
  }

  /**
   * Invokes the SES audit event cleanup job (two-tier: non-suppressing records
   * then suppression records) and wraps it with start/end log messages.
   * Errors are logged and swallowed to allow subsequent jobs to proceed.
   */
  private async handleSesAuditCleanup() {
    this.logger.log('Starting SES audit cleanup job...');
    try {
      await this.sesAuditCleanupService.cleanup();
      this.logger.log('SES audit cleanup job completed successfully.');
    } catch (error) {
      this.logger.error('Error running SES audit cleanup job:', error);
    }
  }

  /**
   * Invokes the user-account cleanup job for permanently deleting closed
   * accounts once their retention period has elapsed.
   */
  private async handleUserAccountCleanup() {
    this.logger.log('Starting user account cleanup job...');
    try {
      await this.userAccountCleanupService.cleanup();
      this.logger.log('User account cleanup job completed successfully.');
    } catch (error) {
      this.logger.error('Error running user account cleanup job:', error);
    }
  }
}
