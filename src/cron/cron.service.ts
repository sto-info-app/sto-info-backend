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
  private readonly _logger = new Logger(CronService.name);

  /**
   * Creates an instance of CronService.
   *
   * @param _auditCleanupService - The audit cleanup service.
   * @param _auditLoginAttemptCleanupService - The audit login attempt cleanup service.
   * @param _contactRequestCleanupService - The contact request cleanup service.
   * @param _sesAuditCleanupService - The ses audit cleanup service.
   * @param _userAccountCleanupService - The user account cleanup service.
   */
  constructor(
    private readonly _auditCleanupService: AuditCleanupService,
    private readonly _auditLoginAttemptCleanupService: AuditLoginAttemptCleanupService,
    private readonly _contactRequestCleanupService: ContactRequestCleanupService,
    private readonly _sesAuditCleanupService: SesAuditCleanupService,
    private readonly _userAccountCleanupService: UserAccountCleanupService,
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
    this._logger.log('Running daily midnight jobs...');
    try {
      await this.handleAuditCleanup();
      await this.handleAuditLoginAttemptCleanup();
      await this.handleContactRequestCleanup();
      await this.handleSesAuditCleanup();
      await this.handleUserAccountCleanup();
    } catch (error) {
      this._logger.error('Error running daily midnight jobs:', error);
    }
  }

  /**
   * Invokes the general audit log cleanup job and wraps it with start/end
   * log messages. Errors are logged and swallowed to allow subsequent jobs
   * to proceed.
   */
  private async handleAuditCleanup() {
    this._logger.log('Starting audit cleanup job...');
    try {
      await this._auditCleanupService.cleanup();
      this._logger.log('Audit cleanup job completed successfully.');
    } catch (error) {
      this._logger.error('Error running audit cleanup job:', error);
    }
  }

  /**
   * Invokes the audit login-attempt cleanup job and wraps it with start/end
   * log messages. Errors are logged and swallowed to allow subsequent jobs
   * to proceed.
   */
  private async handleAuditLoginAttemptCleanup() {
    this._logger.log('Starting audit login attempt cleanup job...');
    try {
      await this._auditLoginAttemptCleanupService.cleanup();
      this._logger.log(
        'Audit login attempt cleanup job completed successfully.',
      );
    } catch (error) {
      this._logger.error(
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
    this._logger.log('Starting contact request cleanup job...');
    try {
      await this._contactRequestCleanupService.cleanup();
      this._logger.log('Contact request cleanup job completed successfully.');
    } catch (error) {
      this._logger.error('Error running contact request cleanup job:', error);
    }
  }

  /**
   * Invokes the SES audit event cleanup job (two-tier: non-suppressing records
   * then suppression records) and wraps it with start/end log messages.
   * Errors are logged and swallowed to allow subsequent jobs to proceed.
   */
  private async handleSesAuditCleanup() {
    this._logger.log('Starting SES audit cleanup job...');
    try {
      await this._sesAuditCleanupService.cleanup();
      this._logger.log('SES audit cleanup job completed successfully.');
    } catch (error) {
      this._logger.error('Error running SES audit cleanup job:', error);
    }
  }

  /**
   * Invokes the user-account cleanup job for permanently deleting closed
   * accounts once their retention period has elapsed.
   */
  private async handleUserAccountCleanup() {
    this._logger.log('Starting user account cleanup job...');
    try {
      await this._userAccountCleanupService.cleanup();
      this._logger.log('User account cleanup job completed successfully.');
    } catch (error) {
      this._logger.error('Error running user account cleanup job:', error);
    }
  }
}
