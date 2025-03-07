import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CRON_TIMEZONE } from './constants/cron.constants';
import { AuditCleanupService } from './jobs/audit-cleanup/audit-cleanup.service';
import { AuditLoginAttemptCleanupService } from './jobs/audit-login-attempt-cleanup/audit-login-attempt-cleanup.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly auditCleanupService: AuditCleanupService,
    private readonly auditLoginAttemptCleanupService: AuditLoginAttemptCleanupService,
  ) {}

  /**
   * Run daily midnight jobs
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: CRON_TIMEZONE })
  async dailyMidnightJobs() {
    this.logger.log('Running daily midnight jobs...');
    try {
      await this.handleAuditCleanup();
      await this.handleAuditLoginAttemptCleanup();
    } catch (error) {
      this.logger.error('Error running daily midnight jobs:', error);
    }
  }

  /**
   * Cleanup old audit logs
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
   * Cleanup old audit login attempt logs
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
}
