import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import { ReportStatus } from '../../moderation/enums/report-status.enum';
import { AppealStatus } from '../enums/appeal-status.enum';
import { StorytimeReportReason } from '../enums/storytime-report-reason.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeModerationAppealEntity } from './entities/storytime-moderation-appeal.entity';
import { StorytimeReportEntity } from './entities/storytime-report.entity';
import { StorytimeAppealService } from './storytime-appeal.service';
import { StorytimeModerationController } from './storytime-moderation.controller';
import { StorytimeModerationMapper } from './storytime-moderation.mapper';
import { StorytimeReportService } from './storytime-report.service';

describe('StorytimeModerationController', () => {
  let controller: StorytimeModerationController;
  let reportService: { create: jest.Mock };
  let appealService: {
    create: jest.Mock;
    findMine: jest.Mock;
    withdraw: jest.Mock;
  };

  const userId = 'reader-1';

  const report = Object.assign(new StorytimeReportEntity(), {
    id: 'report-1',
    reporterUserId: userId,
    targetType: StorytimeTargetType.STORY,
    targetId: 'story-1',
    reasonCode: StorytimeReportReason.HARASSMENT,
    description: 'Chapter three names a real person.',
    status: ReportStatus.OPEN,
    assignedToUserId: null,
    resolution: null,
    resolvedAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
  });

  const appeal = Object.assign(new StorytimeModerationAppealEntity(), {
    id: 'appeal-1',
    targetType: StorytimeTargetType.STORY,
    targetId: 'story-1',
    appellantUserId: userId,
    body: 'The passage quoted is my own writing.',
    status: AppealStatus.SUBMITTED,
    reviewNotes: null,
    reviewedAt: null,
    createdAt: new Date('2026-06-03T00:00:00.000Z'),
  });

  beforeEach(async () => {
    reportService = { create: jest.fn().mockResolvedValue(report) };
    appealService = {
      create: jest.fn().mockResolvedValue(appeal),
      findMine: jest.fn().mockResolvedValue([appeal]),
      withdraw: jest.fn().mockResolvedValue(appeal),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeModerationController],
      providers: [
        { provide: StorytimeReportService, useValue: reportService },
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

    controller = module.get<StorytimeModerationController>(
      StorytimeModerationController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('takes a report and answers with a receipt', async () => {
    const receipt = await controller.report(
      {
        targetType: StorytimeTargetType.STORY,
        targetId: 'story-1',
        reasonCode: StorytimeReportReason.HARASSMENT,
      },
      userId,
    );

    expect(receipt.id).toBe('report-1');
    expect(reportService.create).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'story-1' }),
      userId,
    );
  });

  // A reporter is told their report arrived, never what an administrator wrote
  // about somebody else's work.
  it('answers a reporter with nothing about the decision', async () => {
    const receipt = await controller.report(
      {
        targetType: StorytimeTargetType.STORY,
        targetId: 'story-1',
        reasonCode: StorytimeReportReason.HARASSMENT,
      },
      userId,
    );

    expect(receipt as unknown as Record<string, unknown>).not.toHaveProperty(
      'resolution',
    );
  });

  it('takes an appeal', async () => {
    const raised = await controller.appeal(
      {
        targetType: StorytimeTargetType.STORY,
        targetId: 'story-1',
        body: 'The passage quoted is my own writing.',
      },
      userId,
    );

    expect(raised.status).toBe(AppealStatus.SUBMITTED);
    expect(appealService.create).toHaveBeenCalled();
  });

  it('lists the caller’s own appeals', async () => {
    const mine = await controller.findMyAppeals(userId);

    expect(mine).toHaveLength(1);
    expect(appealService.findMine).toHaveBeenCalledWith(userId);
  });

  it('withdraws an appeal', async () => {
    await controller.withdrawAppeal('appeal-1', userId);

    expect(appealService.withdraw).toHaveBeenCalledWith('appeal-1', userId);
  });
});
