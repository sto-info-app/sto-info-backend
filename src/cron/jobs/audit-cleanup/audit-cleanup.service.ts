import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, LessThan, Not, Repository } from 'typeorm';

import { AuditEntity } from 'src/audit/entities/audit.entity';
import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';
import {
  AUDIT_DATA_NUKE_THRESHOLD_DAYS,
  AUDIT_IP_NUKE_THRESHOLD_DAYS,
} from 'src/cron/constants/cron.constants';

@Injectable()
export class AuditCleanupService {
  private readonly _logger = new Logger(AuditCleanupService.name);

  /**
   * Creates an instance of AuditCleanupService.
   *
   * @param _auditRepository - The audit repository.
   */
  constructor(
    @InjectRepository(AuditEntity)
    private readonly _auditRepository: Repository<AuditEntity>,
  ) {}

  /**
   * Removes stale records.
   */
  async cleanup(): Promise<void> {
    // Delete audit records older than data threshold date
    const thresholdDate = new Date();
    thresholdDate.setDate(
      thresholdDate.getDate() - AUDIT_DATA_NUKE_THRESHOLD_DAYS,
    );

    const deleteResult = await this._auditRepository.delete({
      createdAt: LessThan(thresholdDate),
    });

    this._logger.log(
      `Deleted ${deleteResult.affected} audit records older than ${AUDIT_DATA_NUKE_THRESHOLD_DAYS} days.`,
    );

    // Set IP address to null for audit records older than IP threshold date
    const ipNukeThresholdDate = new Date();
    ipNukeThresholdDate.setDate(
      ipNukeThresholdDate.getDate() - AUDIT_IP_NUKE_THRESHOLD_DAYS,
    );

    const updateResult = await this._auditRepository.update(
      { createdAt: LessThan(ipNukeThresholdDate) },
      { ipAddress: null },
    );

    this._logger.log(
      `Set IP address to null for ${updateResult.affected} audit records older than ${AUDIT_IP_NUKE_THRESHOLD_DAYS} days.`,
    );

    // The site admin log follows the same policy (FC-039).
    const manager = this._auditRepository.manager;
    const adminDeleted = await manager.delete(SiteAdminActionEntity, {
      createdAt: LessThan(thresholdDate),
    });
    const adminForgotten = await manager.update(
      SiteAdminActionEntity,
      { createdAt: LessThan(ipNukeThresholdDate), ipAddress: Not(IsNull()) },
      { ipAddress: null },
    );

    this._logger.log(
      `Site admin log: deleted ${adminDeleted.affected} record(s), and forgot the IP address of ${adminForgotten.affected}.`,
    );
  }
}
