import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReportStatus } from '../../moderation/enums/report-status.enum';
import { StorytimeModerationAction } from '../enums/storytime-moderation-action.enum';
import { StorytimeReportReason } from '../enums/storytime-report-reason.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeReportEntity } from './entities/storytime-report.entity';
import { StorytimeModerationTargetService } from './storytime-moderation-target.service';
import { StorytimeModerationService } from './storytime-moderation.service';
import { StorytimeReportService } from './storytime-report.service';

describe('StorytimeReportService', () => {
  let service: StorytimeReportService;
  let reportRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
  };
  let targetService: { find: jest.Mock; isModeratable: jest.Mock };
  let moderationService: { record: jest.Mock };

  const reporterId = 'reader-1';
  const adminId = 'admin-1';
  const storyId = 'story-1';
  const reportId = 'report-1';

  /** A report request. */
  const request = {
    targetType: StorytimeTargetType.STORY,
    targetId: storyId,
    reasonCode: StorytimeReportReason.HARASSMENT,
    description: 'Chapter three names a real person.',
  };

  /**
   * Builds a report.
   *
   * @param overrides - Fields to change.
   * @returns The report.
   */
  const buildReport = (
    overrides: Partial<StorytimeReportEntity> = {},
  ): StorytimeReportEntity =>
    Object.assign(new StorytimeReportEntity(), {
      id: reportId,
      reporterUserId: reporterId,
      targetType: StorytimeTargetType.STORY,
      targetId: storyId,
      reasonCode: StorytimeReportReason.HARASSMENT,
      description: null,
      status: ReportStatus.OPEN,
      assignedToUserId: null,
      resolution: null,
      resolvedAt: null,
      ...overrides,
    });

  beforeEach(async () => {
    reportRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input =>
        Object.assign(new StorytimeReportEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      count: jest.fn().mockResolvedValue(0),
    };
    targetService = {
      find: jest.fn().mockResolvedValue({
        content: { id: storyId },
        ownerUserId: 'writer-1',
        label: 'A Fine Story',
      }),
      isModeratable: jest.fn().mockReturnValue(true),
    };
    moderationService = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeReportService,
        {
          provide: getRepositoryToken(StorytimeReportEntity),
          useValue: reportRepository,
        },
        {
          provide: StorytimeModerationTargetService,
          useValue: targetService,
        },
        { provide: StorytimeModerationService, useValue: moderationService },
      ],
    }).compile();

    service = module.get<StorytimeReportService>(StorytimeReportService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('raising a report', () => {
    it('records what was reported and why', async () => {
      const report = await service.create(request, reporterId);

      expect(report.reporterUserId).toBe(reporterId);
      expect(report.targetId).toBe(storyId);
      expect(report.reasonCode).toBe(StorytimeReportReason.HARASSMENT);
      expect(report.description).toBe('Chapter three names a real person.');
    });

    // A report is a question for an administrator, never an action in itself.
    it('leaves the report open rather than acting on anything', async () => {
      const report = await service.create(request, reporterId);

      expect(report.status).toBe(ReportStatus.OPEN);
      expect(moderationService.record).not.toHaveBeenCalled();
    });

    it('accepts a report with no description', async () => {
      const report = await service.create(
        { ...request, description: undefined },
        reporterId,
      );

      expect(report.description).toBeNull();
    });

    it('refuses a second live report of the same thing', async () => {
      reportRepository.findOne.mockResolvedValue(buildReport());

      await expect(service.create(request, reporterId)).rejects.toThrow(
        /already reported this/,
      );
    });

    it('reports content that does not exist', async () => {
      targetService.find.mockResolvedValue(null);

      await expect(service.create(request, reporterId)).rejects.toThrow(
        NotFoundException,
      );
    });

    // A comment or a media embed is reportable but is not a row this service
    // can look up, so it takes the report on trust rather than refusing it.
    it('accepts a report about something it cannot look up', async () => {
      targetService.isModeratable.mockReturnValue(false);

      await expect(
        service.create(
          { ...request, targetType: StorytimeTargetType.COMMENT },
          reporterId,
        ),
      ).resolves.toBeDefined();
      expect(targetService.find).not.toHaveBeenCalled();
    });
  });

  describe('the queue', () => {
    // A queue sorted by anything else is a queue where the awkward reports are
    // never reached.
    it('shows open work first, oldest first within it', async () => {
      await service.findForAdmin();

      expect(reportRepository.find).toHaveBeenCalledWith({
        where: {},
        order: { status: 'ASC', createdAt: 'ASC' },
      });
    });

    it('filters to one state', async () => {
      await service.findForAdmin(ReportStatus.OPEN);

      expect(reportRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: ReportStatus.OPEN } }),
      );
    });

    it('lists everything said about one piece of content', async () => {
      await service.findForTarget(StorytimeTargetType.STORY, storyId);

      expect(reportRepository.find).toHaveBeenCalledWith({
        where: { targetType: StorytimeTargetType.STORY, targetId: storyId },
        order: { createdAt: 'DESC' },
      });
    });

    it('counts what is still waiting', async () => {
      await service.countUnresolved();

      expect(reportRepository.count).toHaveBeenCalled();
    });

    it('reads one report', async () => {
      reportRepository.findOne.mockResolvedValue(buildReport());

      await expect(service.findOneOrFail(reportId)).resolves.toBeDefined();
    });

    it('reports one that is not there', async () => {
      await expect(service.findOneOrFail(reportId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('working through a report', () => {
    beforeEach(() => {
      reportRepository.findOne.mockResolvedValue(buildReport());
    });

    it('claims a report for whoever moved it', async () => {
      const resolved = await service.resolve(
        reportId,
        { status: ReportStatus.UNDER_REVIEW },
        adminId,
      );

      expect(resolved.assignedToUserId).toBe(adminId);
      expect(resolved.resolvedAt).toBeNull();
    });

    it.each([ReportStatus.ACTIONED, ReportStatus.DISMISSED])(
      'closes a report moved to %s',
      async status => {
        const resolved = await service.resolve(
          reportId,
          { status, resolution: 'Removed under the harassment policy.' },
          adminId,
        );

        expect(resolved.resolvedAt).toBeInstanceOf(Date);
        expect(resolved.resolution).toContain('harassment policy');
      },
    );

    // The history of a piece of content should say a complaint about it was
    // dealt with, not only that somebody removed something.
    it('records the closure in the content’s history', async () => {
      await service.resolve(
        reportId,
        { status: ReportStatus.DISMISSED, resolution: 'Within the rating.' },
        adminId,
      );

      expect(moderationService.record).toHaveBeenCalledWith(
        StorytimeTargetType.STORY,
        storyId,
        StorytimeModerationAction.REPORT_RESOLVED,
        adminId,
        StorytimeReportReason.HARASSMENT,
        'Within the rating.',
      );
    });

    it('records nothing while a report is still open', async () => {
      await service.resolve(reportId, { status: ReportStatus.OPEN }, adminId);

      expect(moderationService.record).not.toHaveBeenCalled();
    });

    it('keeps the previous resolution when none is sent', async () => {
      reportRepository.findOne.mockResolvedValue(
        buildReport({ resolution: 'Already explained.' }),
      );

      const resolved = await service.resolve(
        reportId,
        { status: ReportStatus.ACTIONED },
        adminId,
      );

      expect(resolved.resolution).toBe('Already explained.');
    });

    it('reports a report that is not there', async () => {
      reportRepository.findOne.mockResolvedValue(null);

      await expect(
        service.resolve(reportId, { status: ReportStatus.ACTIONED }, adminId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('refuses nothing it was not asked to refuse', async () => {
    await expect(service.create(request, reporterId)).resolves.toBeDefined();
    expect(reportRepository.save).toHaveBeenCalled();
  });

  it('surfaces a duplicate as a bad request rather than a crash', async () => {
    reportRepository.findOne.mockResolvedValue(buildReport());

    await expect(service.create(request, reporterId)).rejects.toThrow(
      BadRequestException,
    );
  });
});
