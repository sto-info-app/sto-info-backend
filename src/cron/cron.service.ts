import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { MemoryDiagnosticsService } from '../diagnostics/memory-diagnostics.service';
import { CRON_TIMEZONE } from './constants/cron.constants';
import { AuditCleanupService } from './jobs/audit-cleanup/audit-cleanup.service';
import { AuditLoginAttemptCleanupService } from './jobs/audit-login-attempt-cleanup/audit-login-attempt-cleanup.service';
import { ContactRequestCleanupService } from './jobs/contact-request-cleanup/contact-request-cleanup.service';
import { CustomTrackingCleanupService } from './jobs/custom-tracking-cleanup/custom-tracking-cleanup.service';
import { SesAuditCleanupService } from './jobs/ses-audit-cleanup/ses-audit-cleanup.service';
import { UserAccountCleanupService } from './jobs/user-account-cleanup/user-account-cleanup.service';

@Injectable()
export class CronService {
  private readonly _logger = new Logger(CronService.name);

  /**
   * Creates an instance of CronService.
   *
   * @param _memoryDiagnostics - The shared process diagnostics service.
   * @param _auditCleanupService - The audit cleanup service.
   * @param _auditLoginAttemptCleanupService - The audit login attempt cleanup service.
   * @param _contactRequestCleanupService - The contact request cleanup service.
   * @param _sesAuditCleanupService - The ses audit cleanup service.
   * @param _userAccountCleanupService - The user account cleanup service.
   * @param _customTrackingCleanupService - The custom tracking cleanup service.
   */
  constructor(
    private readonly _memoryDiagnostics: MemoryDiagnosticsService,
    private readonly _auditCleanupService: AuditCleanupService,
    private readonly _auditLoginAttemptCleanupService: AuditLoginAttemptCleanupService,
    private readonly _contactRequestCleanupService: ContactRequestCleanupService,
    private readonly _sesAuditCleanupService: SesAuditCleanupService,
    private readonly _userAccountCleanupService: UserAccountCleanupService,
    private readonly _customTrackingCleanupService: CustomTrackingCleanupService,
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
      await this.handleCustomTrackingCleanup();
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
    this._memoryDiagnostics.recordCronExecution();
    this._memoryDiagnostics.logMemory('audit-cleanup:before');
    try {
      await this._auditCleanupService.cleanup();
      this._logger.log('Audit cleanup job completed successfully.');
    } catch (error) {
      this._logger.error('Error running audit cleanup job:', error);
    } finally {
      this._memoryDiagnostics.logMemory('audit-cleanup:after');
    }
  }

  /**
   * Invokes the audit login-attempt cleanup job and wraps it with start/end
   * log messages. Errors are logged and swallowed to allow subsequent jobs
   * to proceed.
   */
  private async handleAuditLoginAttemptCleanup() {
    this._logger.log('Starting audit login attempt cleanup job...');
    this._memoryDiagnostics.recordCronExecution();
    this._memoryDiagnostics.logMemory('audit-login-attempt-cleanup:before');
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
    } finally {
      this._memoryDiagnostics.logMemory('audit-login-attempt-cleanup:after');
    }
  }

  /**
   * Invokes the contact-request cleanup job (record deletion + email-mask
   * nulling) and wraps it with start/end log messages. Errors are logged and
   * swallowed to allow subsequent jobs to proceed.
   */
  private async handleContactRequestCleanup() {
    this._logger.log('Starting contact request cleanup job...');
    this._memoryDiagnostics.recordCronExecution();
    this._memoryDiagnostics.logMemory('contact-request-cleanup:before');
    try {
      await this._contactRequestCleanupService.cleanup();
      this._logger.log('Contact request cleanup job completed successfully.');
    } catch (error) {
      this._logger.error('Error running contact request cleanup job:', error);
    } finally {
      this._memoryDiagnostics.logMemory('contact-request-cleanup:after');
    }
  }

  /**
   * Invokes the SES audit event cleanup job (two-tier: non-suppressing records
   * then suppression records) and wraps it with start/end log messages.
   * Errors are logged and swallowed to allow subsequent jobs to proceed.
   */
  private async handleSesAuditCleanup() {
    this._logger.log('Starting SES audit cleanup job...');
    this._memoryDiagnostics.recordCronExecution();
    this._memoryDiagnostics.logMemory('ses-audit-cleanup:before');
    try {
      await this._sesAuditCleanupService.cleanup();
      this._logger.log('SES audit cleanup job completed successfully.');
    } catch (error) {
      this._logger.error('Error running SES audit cleanup job:', error);
    } finally {
      this._memoryDiagnostics.logMemory('ses-audit-cleanup:after');
    }
  }

  /**
   * Invokes the user-account cleanup job for permanently deleting closed
   * accounts once their retention period has elapsed.
   */
  private async handleUserAccountCleanup() {
    this._logger.log('Starting user account cleanup job...');
    this._memoryDiagnostics.recordCronExecution();
    this._memoryDiagnostics.logMemory('user-account-cleanup:before');
    try {
      await this._userAccountCleanupService.cleanup();
      this._logger.log('User account cleanup job completed successfully.');
    } catch (error) {
      this._logger.error('Error running user account cleanup job:', error);
    } finally {
      this._memoryDiagnostics.logMemory('user-account-cleanup:after');
    }
  }

  /**
   * Invokes the Custom Tracking cleanup job: expired definitions and answers,
   * and then the pictures that leaves behind in Cloudflare.
   *
   * Last of the six, so that its picture-deletion pass also drains whatever
   * the account cleanup queued a moment earlier.
   */
  private async handleCustomTrackingCleanup() {
    this._logger.log('Starting custom tracking cleanup job...');
    this._memoryDiagnostics.recordCronExecution();
    this._memoryDiagnostics.logMemory('custom-tracking-cleanup:before');
    try {
      await this._customTrackingCleanupService.cleanup();
      this._logger.log('Custom tracking cleanup job completed successfully.');
    } catch (error) {
      this._logger.error('Error running custom tracking cleanup job:', error);
    } finally {
      this._memoryDiagnostics.logMemory('custom-tracking-cleanup:after');
    }
  }
}
