import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ReportStatus } from '../../moderation/enums/report-status.enum';
import { StorytimeModerationAction } from '../enums/storytime-moderation-action.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { CreateStorytimeReportDto } from './dto/create-storytime-report.dto';
import { ResolveStorytimeReportDto } from './dto/resolve-storytime-report.dto';
import { StorytimeReportEntity } from './entities/storytime-report.entity';
import { StorytimeModerationService } from './storytime-moderation.service';
import { StorytimeModerationTargetService } from './storytime-moderation-target.service';

/** The states a report is still being worked on in. */
const LIVE_STATUSES = [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW];

/**
 * Reports about Storytime content.
 *
 * A report never removes anything. It puts the content in front of an
 * administrator, who decides — which is what stops reporting from being a way
 * to silence somebody by consensus.
 */
@Injectable()
export class StorytimeReportService {
  private readonly _logger = new Logger(StorytimeReportService.name);

  /**
   * Creates an instance of StorytimeReportService.
   *
   * @param _reportRepository - Repository of reports.
   * @param _targetService - Resolves the content being reported.
   * @param _moderationService - Writes the audit trail.
   */
  constructor(
    @InjectRepository(StorytimeReportEntity)
    private readonly _reportRepository: Repository<StorytimeReportEntity>,
    private readonly _targetService: StorytimeModerationTargetService,
    private readonly _moderationService: StorytimeModerationService,
  ) {}

  /**
   * Raises a report about a piece of content.
   *
   * @param dto - What is being reported and why.
   * @param reporterUserId - The reader raising it.
   * @returns The report.
   */
  async create(
    dto: CreateStorytimeReportDto,
    reporterUserId: string,
  ): Promise<StorytimeReportEntity> {
    await this.assertReportable(dto.targetType, dto.targetId);

    const existing = await this._reportRepository.findOne({
      where: {
        reporterUserId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        status: In(LIVE_STATUSES),
      },
    });

    if (existing) {
      throw new BadRequestException(
        'You have already reported this, and it is still being looked at.',
      );
    }

    const report = await this._reportRepository.save(
      this._reportRepository.create({
        reporterUserId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reasonCode: dto.reasonCode,
        description: dto.description ?? null,
        status: ReportStatus.OPEN,
      }),
    );

    this._logger.log(
      `Report ${report.id} raised against ${dto.targetType} ${dto.targetId}`,
    );

    return report;
  }

  /**
   * Lists the reports in the queue.
   *
   * Open work first and oldest first within it, because a queue sorted by
   * anything else is a queue where the awkward reports are never reached.
   *
   * @param status - The status to filter to, if any.
   * @returns The reports.
   */
  findForAdmin(status?: ReportStatus): Promise<StorytimeReportEntity[]> {
    return this._reportRepository.find({
      where: status ? { status } : {},
      order: { status: 'ASC', createdAt: 'ASC' },
    });
  }

  /**
   * Lists every report raised about one piece of content.
   *
   * @param targetType - The kind of content.
   * @param targetId - The content.
   * @returns The reports, most recent first.
   */
  findForTarget(
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<StorytimeReportEntity[]> {
    return this._reportRepository.find({
      where: { targetType, targetId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Retrieves one report.
   *
   * @param reportId - The report.
   * @returns The report.
   * @throws NotFoundException when no report has that identifier.
   */
  async findOneOrFail(reportId: string): Promise<StorytimeReportEntity> {
    const report = await this._reportRepository.findOne({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException('That report could not be found.');
    }

    return report;
  }

  /**
   * Moves a report along, or closes it.
   *
   * @param reportId - The report.
   * @param dto - The change.
   * @param actingUserId - The administrator.
   * @returns The report after the change.
   */
  async resolve(
    reportId: string,
    dto: ResolveStorytimeReportDto,
    actingUserId: string,
  ): Promise<StorytimeReportEntity> {
    const report = await this.findOneOrFail(reportId);

    report.status = dto.status;
    report.resolution = dto.resolution ?? report.resolution;
    // Claiming it is what `UNDER_REVIEW` means, so the administrator who moves
    // it there is the one it belongs to until they say otherwise.
    report.assignedToUserId = actingUserId;
    report.resolvedAt = LIVE_STATUSES.includes(dto.status) ? null : new Date();

    const saved = await this._reportRepository.save(report);

    if (saved.resolvedAt) {
      await this._moderationService.record(
        saved.targetType,
        saved.targetId,
        StorytimeModerationAction.REPORT_RESOLVED,
        actingUserId,
        saved.reasonCode,
        dto.resolution ?? null,
      );
    }

    return saved;
  }

  /**
   * Counts the reports still waiting on somebody.
   *
   * @returns How many are open or under review.
   */
  countUnresolved(): Promise<number> {
    return this._reportRepository.count({
      where: { status: In(LIVE_STATUSES) },
    });
  }

  /**
   * Refuses a report about something that is not there.
   *
   * Checked because a report naming content that does not exist is either a
   * mistake or an attempt to fill the queue, and neither is worth an
   * administrator's time.
   *
   * @param targetType - The kind of content.
   * @param targetId - The content.
   * @throws NotFoundException when the content does not exist.
   */
  private async assertReportable(
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<void> {
    if (!this._targetService.isModeratable(targetType)) {
      return;
    }

    const target = await this._targetService.find(targetType, targetId);

    if (!target) {
      throw new NotFoundException('That content could not be found.');
    }
  }
}
