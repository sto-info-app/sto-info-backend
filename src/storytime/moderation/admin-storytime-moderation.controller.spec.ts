import { Test, TestingModule } from '@nestjs/testing';

import { AccessControlService } from '../../access-control/access-control.service';
import { ReportStatus } from '../../moderation/enums/report-status.enum';
import { AppealStatus } from '../enums/appeal-status.enum';
import { StorytimeModerationAction } from '../enums/storytime-moderation-action.enum';
import { StorytimeReportReason } from '../enums/storytime-report-reason.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { AdminStorytimeModerationController } from './admin-storytime-moderation.controller';
import { StorytimeModerationActionEntity } from './entities/storytime-moderation-action.entity';
import { StorytimeModerationAppealEntity } from './entities/storytime-moderation-appeal.entity';
import { StorytimeReportEntity } from './entities/storytime-report.entity';
import { StorytimeAppealService } from './storytime-appeal.service';
import { StorytimeModerationMapper } from './storytime-moderation.mapper';
import { StorytimeModerationService } from './storytime-moderation.service';
import { StorytimeReportService } from './storytime-report.service';

describe('AdminStorytimeModerationController', () => {
  let controller: AdminStorytimeModerationController;
  let reportService: {
    findForAdmin: jest.Mock;
    findForTarget: jest.Mock;
    findOneOrFail: jest.Mock;
    resolve: jest.Mock;
  };
  let moderationService: {
    remove: jest.Mock;
    restore: jest.Mock;
    findHistory: jest.Mock;
  };
  let appealService: { findForAdmin: jest.Mock; decide: jest.Mock };

  const adminId = 'admin-1';
  const storyId = 'story-1';

  const report = Object.assign(new StorytimeReportEntity(), {
    id: 'report-1',
    reporterUserId: 'reader-1',
    targetType: StorytimeTargetType.STORY,
    targetId: storyId,
    reasonCode: StorytimeReportReason.HARASSMENT,
    description: null,
    status: ReportStatus.OPEN,
    assignedToUserId: null,
    resolution: null,
    resolvedAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
  });

  const action = Object.assign(new StorytimeModerationActionEntity(), {
    id: 'action-1',
    targetType: StorytimeTargetType.STORY,
    targetId: storyId,
    action: StorytimeModerationAction.REMOVED,
    actorUserId: adminId,
    reasonCode: 'HARASSMENT',
    message: 'This breaches the harassment policy.',
    createdAt: new Date('2026-06-02T00:00:00.000Z'),
  });

  const appeal = Object.assign(new StorytimeModerationAppealEntity(), {
    id: 'appeal-1',
    targetType: StorytimeTargetType.STORY,
    targetId: storyId,
    appellantUserId: 'writer-1',
    body: 'The passage quoted is my own writing.',
    status: AppealStatus.SUBMITTED,
    reviewNotes: null,
    reviewedAt: null,
    createdAt: new Date('2026-06-03T00:00:00.000Z'),
  });

  /** A removal request. */
  const request = {
    targetType: StorytimeTargetType.STORY,
    targetId: storyId,
    reasonCode: StorytimeReportReason.HARASSMENT,
    message: 'This breaches the harassment policy.',
  };

  beforeEach(async () => {
    reportService = {
      findForAdmin: jest.fn().mockResolvedValue([report]),
      findForTarget: jest.fn().mockResolvedValue([report]),
      findOneOrFail: jest.fn().mockResolvedValue(report),
      resolve: jest.fn().mockResolvedValue(report),
    };
    moderationService = {
      remove: jest.fn().mockResolvedValue(action),
      restore: jest.fn().mockResolvedValue(action),
      findHistory: jest.fn().mockResolvedValue([action]),
    };
    appealService = {
      findForAdmin: jest.fn().mockResolvedValue([appeal]),
      decide: jest.fn().mockResolvedValue(appeal),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminStorytimeModerationController],
      providers: [
        { provide: StorytimeReportService, useValue: reportService },
        { provide: StorytimeModerationService, useValue: moderationService },
        { provide: StorytimeAppealService, useValue: appealService },
        StorytimeModerationMapper,
        // The permissions guard declared on the controller needs this to be
        // constructible. Its behaviour is covered by its own spec.
        {
          provide: AccessControlService,
          useValue: { getPermissionCodes: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<AdminStorytimeModerationController>(
      AdminStorytimeModerationController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists the queue', async () => {
    const reports = await controller.findReports({});

    expect(reports).toHaveLength(1);
    expect(reportService.findForAdmin).toHaveBeenCalledWith(undefined);
  });

  it('filters the queue by state', async () => {
    await controller.findReports({ status: ReportStatus.OPEN });

    expect(reportService.findForAdmin).toHaveBeenCalledWith(ReportStatus.OPEN);
  });

  it('reads one report', async () => {
    const found = await controller.findReport('report-1');

    expect(found.id).toBe('report-1');
  });

  it('moves a report along', async () => {
    await controller.resolveReport(
      'report-1',
      { status: ReportStatus.DISMISSED, resolution: 'Within the rating.' },
      adminId,
    );

    expect(reportService.resolve).toHaveBeenCalledWith(
      'report-1',
      { status: ReportStatus.DISMISSED, resolution: 'Within the rating.' },
      adminId,
    );
  });

  it('lists what has been said about one piece of content', async () => {
    await controller.findReportsForTarget(StorytimeTargetType.STORY, storyId);

    expect(reportService.findForTarget).toHaveBeenCalledWith(
      StorytimeTargetType.STORY,
      storyId,
    );
  });

  it('reads a piece of content’s history', async () => {
    const history = await controller.findHistory(
      StorytimeTargetType.STORY,
      storyId,
    );

    expect(history[0].action).toBe(StorytimeModerationAction.REMOVED);
  });

  it('removes content', async () => {
    const entry = await controller.remove(request, adminId);

    expect(entry.action).toBe(StorytimeModerationAction.REMOVED);
    expect(moderationService.remove).toHaveBeenCalledWith(request, adminId);
  });

  it('restores content', async () => {
    await controller.restore(request, adminId);

    expect(moderationService.restore).toHaveBeenCalledWith(request, adminId);
  });

  it('lists appeals', async () => {
    const appeals = await controller.findAppeals();

    expect(appeals).toHaveLength(1);
    expect(appealService.findForAdmin).toHaveBeenCalledWith(undefined);
  });

  it('filters appeals by state', async () => {
    await controller.findAppeals(AppealStatus.SUBMITTED);

    expect(appealService.findForAdmin).toHaveBeenCalledWith(
      AppealStatus.SUBMITTED,
    );
  });

  it('decides an appeal', async () => {
    await controller.decideAppeal(
      'appeal-1',
      { uphold: true, reviewNotes: 'You are right.' },
      adminId,
    );

    expect(appealService.decide).toHaveBeenCalledWith(
      'appeal-1',
      { uphold: true, reviewNotes: 'You are right.' },
      adminId,
    );
  });
});
