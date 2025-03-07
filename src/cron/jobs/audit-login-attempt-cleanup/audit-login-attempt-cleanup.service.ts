import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLoginAttemptEntity } from 'src/audit/entities/audit-login-attempt.entity';
import { AUDIT_NUKE_THRESHOLD_DAYS } from 'src/cron/constants/cron.constants';
import { LessThan, Repository } from 'typeorm';

@Injectable()
export class AuditLoginAttemptCleanupService {
  private readonly logger = new Logger(AuditLoginAttemptCleanupService.name);

  constructor(
    @InjectRepository(AuditLoginAttemptEntity)
    private readonly auditLoginAttemptRepository: Repository<AuditLoginAttemptEntity>,
  ) {}

  async cleanup(): Promise<void> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - AUDIT_NUKE_THRESHOLD_DAYS);

    const deleteResult = await this.auditLoginAttemptRepository.delete({
      createdAt: LessThan(thresholdDate),
    });

    this.logger.log(
      `Deleted ${deleteResult.affected} audit login attempt records older than ${AUDIT_NUKE_THRESHOLD_DAYS} days.`,
    );
  }
}
