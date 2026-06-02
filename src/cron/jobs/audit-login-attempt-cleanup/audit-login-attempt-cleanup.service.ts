import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLoginAttemptEntity } from 'src/audit/entities/audit-login-attempt.entity';
import {
  AUDIT_DATA_NUKE_THRESHOLD_DAYS,
  AUDIT_IP_NUKE_THRESHOLD_DAYS,
} from 'src/cron/constants/cron.constants';
import { LessThan, Repository } from 'typeorm';

@Injectable()
export class AuditLoginAttemptCleanupService {
  private readonly logger = new Logger(AuditLoginAttemptCleanupService.name);

  /**
   * Creates an instance of AuditLoginAttemptCleanupService.
   *
   * @param auditLoginAttemptRepository - The audit login attempt repository.
   */
  constructor(
    @InjectRepository(AuditLoginAttemptEntity)
    private readonly auditLoginAttemptRepository: Repository<AuditLoginAttemptEntity>,
  ) {}

  /**
   * Removes stale records.
   */
  async cleanup(): Promise<void> {
    // Delete audit login attempt records older than data threshold date
    const thresholdDate = new Date();
    thresholdDate.setDate(
      thresholdDate.getDate() - AUDIT_DATA_NUKE_THRESHOLD_DAYS,
    );

    const deleteResult = await this.auditLoginAttemptRepository.delete({
      createdAt: LessThan(thresholdDate),
    });

    this.logger.log(
      `Deleted ${deleteResult.affected} audit login attempt records older than ${AUDIT_DATA_NUKE_THRESHOLD_DAYS} days.`,
    );

    // Set IP address to null for audit records older than IP threshold date
    const ipNukeThresholdDate = new Date();
    ipNukeThresholdDate.setDate(
      ipNukeThresholdDate.getDate() - AUDIT_IP_NUKE_THRESHOLD_DAYS,
    );

    const updateResult = await this.auditLoginAttemptRepository.update(
      { createdAt: LessThan(ipNukeThresholdDate) },
      { ipAddress: null },
    );

    this.logger.log(
      `Set IP address to null for ${updateResult.affected} audit login attempt records older than ${AUDIT_IP_NUKE_THRESHOLD_DAYS} days.`,
    );
  }
}
