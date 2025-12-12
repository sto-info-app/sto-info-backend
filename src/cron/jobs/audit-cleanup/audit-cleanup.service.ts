import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditEntity } from 'src/audit/entities/audit.entity';
import {
  AUDIT_DATA_NUKE_THRESHOLD_DAYS,
  AUDIT_IP_NUKE_THRESHOLD_DAYS,
} from 'src/cron/constants/cron.constants';
import { LessThan, Repository } from 'typeorm';

@Injectable()
export class AuditCleanupService {
  private readonly logger = new Logger(AuditCleanupService.name);

  constructor(
    @InjectRepository(AuditEntity)
    private readonly auditRepository: Repository<AuditEntity>,
  ) {}

  async cleanup(): Promise<void> {
    // Delete audit records older than data threshold date
    const thresholdDate = new Date();
    thresholdDate.setDate(
      thresholdDate.getDate() - AUDIT_DATA_NUKE_THRESHOLD_DAYS,
    );

    const deleteResult = await this.auditRepository.delete({
      createdAt: LessThan(thresholdDate),
    });

    this.logger.log(
      `Deleted ${deleteResult.affected} audit records older than ${AUDIT_DATA_NUKE_THRESHOLD_DAYS} days.`,
    );

    // Set IP address to null for audit records older than IP threshold date
    const ipNukeThresholdDate = new Date();
    ipNukeThresholdDate.setDate(
      ipNukeThresholdDate.getDate() - AUDIT_IP_NUKE_THRESHOLD_DAYS,
    );

    const updateResult = await this.auditRepository.update(
      { createdAt: LessThan(ipNukeThresholdDate) },
      { ipAddress: null },
    );

    this.logger.log(
      `Set IP address to null for ${updateResult.affected} audit records older than ${AUDIT_IP_NUKE_THRESHOLD_DAYS} days.`,
    );
  }
}
