import { Injectable } from '@nestjs/common';

import {
  ModerationActionDto,
  ModerationAppealDto,
  StorytimeReportDto,
  StorytimeReportReceiptDto,
} from './dto/moderation.dto';
import { StorytimeModerationActionEntity } from './entities/storytime-moderation-action.entity';
import { StorytimeModerationAppealEntity } from './entities/storytime-moderation-appeal.entity';
import { StorytimeReportEntity } from './entities/storytime-report.entity';

/**
 * Turns moderation records into the shapes the API returns.
 *
 * A report has two shapes, built separately: what the reporter gets back is
 * deliberately thin, because everything else in a report is about somebody
 * else's work and is the moderation queue's business alone.
 */
@Injectable()
export class StorytimeModerationMapper {
  /**
   * Maps a report to the receipt its reporter gets.
   *
   * @param report - The report entity.
   * @returns The receipt.
   */
  toReceipt(report: StorytimeReportEntity): StorytimeReportReceiptDto {
    return {
      id: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      status: report.status,
      createdAt: report.createdAt,
    };
  }

  /**
   * Maps a report to the shape the queue shows.
   *
   * @param report - The report entity.
   * @returns The queue entry.
   */
  toReport(report: StorytimeReportEntity): StorytimeReportDto {
    return {
      ...this.toReceipt(report),
      reporterUserId: report.reporterUserId,
      reasonCode: report.reasonCode,
      description: report.description,
      assignedToUserId: report.assignedToUserId,
      resolution: report.resolution,
      resolvedAt: report.resolvedAt,
    };
  }

  /**
   * Maps several reports to the shape the queue shows.
   *
   * @param reports - The report entities.
   * @returns The queue entries.
   */
  toReportList(reports: StorytimeReportEntity[]): StorytimeReportDto[] {
    return reports.map(report => this.toReport(report));
  }

  /**
   * Maps an audit entry.
   *
   * @param action - The audit entity.
   * @returns The history entry.
   */
  toAction(action: StorytimeModerationActionEntity): ModerationActionDto {
    return {
      id: action.id,
      targetType: action.targetType,
      targetId: action.targetId,
      action: action.action,
      actorUserId: action.actorUserId,
      reasonCode: action.reasonCode,
      message: action.message,
      createdAt: action.createdAt,
    };
  }

  /**
   * Maps several audit entries.
   *
   * @param actions - The audit entities.
   * @returns The history.
   */
  toActionList(
    actions: StorytimeModerationActionEntity[],
  ): ModerationActionDto[] {
    return actions.map(action => this.toAction(action));
  }

  /**
   * Maps an appeal.
   *
   * @param appeal - The appeal entity.
   * @returns The appeal.
   */
  toAppeal(appeal: StorytimeModerationAppealEntity): ModerationAppealDto {
    return {
      id: appeal.id,
      targetType: appeal.targetType,
      targetId: appeal.targetId,
      appellantUserId: appeal.appellantUserId,
      body: appeal.body,
      status: appeal.status,
      reviewNotes: appeal.reviewNotes,
      reviewedAt: appeal.reviewedAt,
      createdAt: appeal.createdAt,
    };
  }

  /**
   * Maps several appeals.
   *
   * @param appeals - The appeal entities.
   * @returns The appeals.
   */
  toAppealList(
    appeals: StorytimeModerationAppealEntity[],
  ): ModerationAppealDto[] {
    return appeals.map(appeal => this.toAppeal(appeal));
  }
}
