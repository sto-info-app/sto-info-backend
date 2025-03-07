import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditEntity } from 'src/audit/entities/audit.entity';
import { AUDIT_NUKE_THRESHOLD_DAYS } from 'src/cron/constants/cron.constants';
import { LessThan, Repository } from 'typeorm';

@Injectable()
export class AuditCleanupService {
  private readonly logger = new Logger(AuditCleanupService.name);

  constructor(
    @InjectRepository(AuditEntity)
    private readonly auditRepository: Repository<AuditEntity>,
  ) {}

  async cleanup(): Promise<void> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - AUDIT_NUKE_THRESHOLD_DAYS);

    const deleteResult = await this.auditRepository.delete({
      createdAt: LessThan(thresholdDate),
    });

    this.logger.log(
      `Deleted ${deleteResult.affected} audit records older than ${AUDIT_NUKE_THRESHOLD_DAYS} days.`,
    );
  }
}
