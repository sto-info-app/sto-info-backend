import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';
import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';

import { PublicMemberService } from '../community/public-member.service';
import { ChatMessageReportEntity } from '../fleet/chat/entities/chat-message-report.entity';
import { UserReportEntity } from './entities/user-report.entity';
import { ReportReason } from './enums/report-reason.enum';
import { ReportStatus } from './enums/report-status.enum';
import { REPORT_MOVED_REASONS, ReportService } from './report.service';

const REPORTER_ID = 'reporter-1';
const REPORTED_ID = 'reported-1';
const ADMIN_ID = 'admin-1';

/**
 * A chainable query-builder test double whose terminal methods are settable.
 */
interface MockQueryBuilder {
  select: jest.Mock;
  addSelect: jest.Mock;
  leftJoinAndSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  orderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getOne: jest.Mock<() => Promise<UserReportEntity | null>>;
  getManyAndCount: jest.Mock<() => Promise<[UserReportEntity[], number]>>;
  getRawMany: jest.Mock<() => Promise<unknown[]>>;
}

/**
 * Builds a self-returning query-builder mock.
 *
 * @returns A chainable query-builder test double.
 */
function createQueryBuilderMock(): MockQueryBuilder {
  const queryBuilder = {} as MockQueryBuilder;

  for (const method of [
    'select',
    'addSelect',
    'leftJoinAndSelect',
    'where',
    'andWhere',
    'groupBy',
    'orderBy',
    'skip',
    'take',
  ] as const) {
    queryBuilder[method] = jest.fn(() => queryBuilder);
  }

  queryBuilder.getOne = jest.fn(() =>
    Promise.resolve(null as UserReportEntity | null),
  );
  queryBuilder.getManyAndCount = jest.fn(() =>
    Promise.resolve([[], 0] as [UserReportEntity[], number]),
  );
  queryBuilder.getRawMany = jest.fn(() => Promise.resolve([] as unknown[]));

  return queryBuilder;
}

/**
 * Builds a report fixture with both members joined in.
 *
 * @param overrides - Fields to override on the fixture.
 * @returns A report-shaped test fixture.
 */
function buildReport(
  overrides: Partial<UserReportEntity> = {},
): UserReportEntity {
  return {
    id: 'report-1',
    reporterId: REPORTER_ID,
    reportedId: REPORTED_ID,
    reason: ReportReason.HARASSMENT,
    details: 'Repeated abusive messages.',
    status: ReportStatus.OPEN,
    moderatorNotes: null,
    reviewedById: null,
    reviewedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    reporter: {
      id: REPORTER_ID,
      isAccountDisabled: false,
      profile: { username: 'reporter', profilePicture100: null },
    },
    reported: {
      id: REPORTED_ID,
      isAccountDisabled: false,
      profile: { username: 'reported', profilePicture100: null },
    },
    reviewedBy: null,
    ...overrides,
  } as UserReportEntity;
}

describe('ReportService', () => {
  let service: ReportService;
  let queryBuilder: MockQueryBuilder;
  let reportRepository: {
    findOne: jest.Mock<() => Promise<UserReportEntity | null>>;
    create: jest.Mock;
    save: jest.Mock<(entity: unknown) => Promise<UserReportEntity>>;
    count: jest.Mock<() => Promise<number>>;
    update: jest.Mock<() => Promise<{ affected?: number }>>;
    createQueryBuilder: jest.Mock;
    manager: {
      find: jest.Mock<() => Promise<unknown[]>>;
      update: jest.Mock<() => Promise<{ affected?: number }>>;
      count: jest.Mock<() => Promise<number>>;
      transaction: jest.Mock;
    };
  };
  /** Every row the site admin log was given (FC-039). */
  let logged: jest.Mock;
  let publicMemberService: {
    requireActiveMember: jest.Mock<() => Promise<{ userId: string }>>;
  };

  beforeEach(async () => {
    queryBuilder = createQueryBuilderMock();

    reportRepository = {
      findOne: jest.fn(() => Promise.resolve(null as UserReportEntity | null)),
      create: jest.fn((values: unknown) => values),
      save: jest.fn((entity: unknown) =>
        Promise.resolve(entity as UserReportEntity),
      ),
      count: jest.fn(() => Promise.resolve(0)),
      update: jest.fn(() => Promise.resolve({ affected: 0 })),
      createQueryBuilder: jest.fn(() => queryBuilder),
      // Chat reports, read through the same database (FC-036).
      manager: {
        find: jest.fn(() => Promise.resolve([] as unknown[])),
        update: jest.fn(() => Promise.resolve({ affected: 0 })),
        count: jest.fn(() => Promise.resolve(0)),
        transaction: jest.fn(),
      },
    };
    logged = jest.fn(() => Promise.resolve(undefined));
    reportRepository.manager.transaction.mockImplementation(((
      work: (manager: object) => Promise<unknown>,
    ) =>
      work({
        save: (_entity: unknown, report: unknown) =>
          reportRepository.save(report),
        insert: logged,
      })) as never);
    publicMemberService = {
      requireActiveMember: jest.fn(() =>
        Promise.resolve({ userId: REPORTED_ID }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        {
          provide: getRepositoryToken(UserReportEntity),
          useValue: reportRepository,
        },
        { provide: PublicMemberService, useValue: publicMemberService },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('reportMember', () => {
    it('should refuse a member reporting themselves', async () => {
      publicMemberService.requireActiveMember.mockResolvedValue({
        userId: REPORTER_ID,
      });

      await expect(
        service.reportMember(REPORTER_ID, {
          username: 'self',
          reason: ReportReason.SPAM,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should store the report against the resolved member', async () => {
      await service.reportMember(REPORTER_ID, {
        username: 'reported',
        reason: ReportReason.HARASSMENT,
        details: 'Repeated abusive messages.',
      });

      expect(reportRepository.create).toHaveBeenCalledWith({
        reporterId: REPORTER_ID,
        reportedId: REPORTED_ID,
        reason: ReportReason.HARASSMENT,
        details: 'Repeated abusive messages.',
        status: ReportStatus.OPEN,
      });
    });

    it('should default the details to null when none are given', async () => {
      await service.reportMember(REPORTER_ID, {
        username: 'reported',
        reason: ReportReason.SPAM,
      });

      expect(reportRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ details: null }),
      );
    });

    it('should refuse a second report while the first is unresolved', async () => {
      reportRepository.findOne.mockResolvedValue(buildReport());

      await expect(
        service.reportMember(REPORTER_ID, {
          username: 'reported',
          reason: ReportReason.SPAM,
        }),
      ).rejects.toThrow(ConflictException);
      expect(reportRepository.save).not.toHaveBeenCalled();
    });

    it('should allow a fresh report once the previous one is resolved', async () => {
      reportRepository.findOne.mockResolvedValue(null);

      await service.reportMember(REPORTER_ID, {
        username: 'reported',
        reason: ReportReason.SPAM,
      });

      expect(reportRepository.save).toHaveBeenCalled();
    });
  });

  describe('findForAdmin', () => {
    it('should page the queue oldest first and report the unresolved count', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[buildReport()], 1]);
      reportRepository.count.mockResolvedValue(7);

      const result = await service.findForAdmin({ page: 2, pageSize: 10 });

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'report.createdAt',
        'ASC',
      );
      expect(queryBuilder.skip).toHaveBeenCalledWith(10);
      expect(queryBuilder.take).toHaveBeenCalledWith(10);
      expect(result.total).toBe(1);
      expect(result.openCount).toBe(7);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'report-1',
          reason: ReportReason.HARASSMENT,
          status: ReportStatus.OPEN,
        }),
      );
    });

    it('should name both members from their profiles', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[buildReport()], 1]);

      const result = await service.findForAdmin({});

      expect(result.items[0].reporter).toEqual({
        userId: REPORTER_ID,
        username: 'reporter',
        profilePicture100: null,
        isAccountDisabled: false,
      });
      expect(result.items[0].reported.username).toBe('reported');
    });

    it('should fall back to the ID when a member has no profile', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([
        [buildReport({ reported: { id: REPORTED_ID } as never })],
        1,
      ]);

      const result = await service.findForAdmin({});

      expect(result.items[0].reported.username).toBeNull();
    });

    it('should filter by status when one is asked for', async () => {
      await service.findForAdmin({ status: ReportStatus.UNDER_REVIEW });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'report.status = :status',
        { status: ReportStatus.UNDER_REVIEW },
      );
    });

    it('should filter by reason when one is asked for', async () => {
      await service.findForAdmin({ reason: ReportReason.SPAM });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'report.reason = :reason',
        { reason: ReportReason.SPAM },
      );
    });

    it('should match the search term against either member username', async () => {
      await service.findForAdmin({ search: 'picard' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('reportedProfile.username'),
        { search: '%picard%' },
      );
    });

    it('should cap the page size', async () => {
      await service.findForAdmin({ pageSize: 500 });

      expect(queryBuilder.take).toHaveBeenCalledWith(50);
    });
  });

  describe('findOneForAdmin', () => {
    it('should throw when no live report matches', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      await expect(service.findOneForAdmin('report-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return the mapped report', async () => {
      queryBuilder.getOne.mockResolvedValue(buildReport());

      await expect(service.findOneForAdmin('report-1')).resolves.toEqual(
        expect.objectContaining({ id: 'report-1' }),
      );
    });
  });

  describe('updateForAdmin', () => {
    it('should stamp the reviewer and the time onto the report', async () => {
      queryBuilder.getOne.mockResolvedValue(buildReport());

      await service.updateForAdmin('report-1', ADMIN_ID, {
        status: ReportStatus.DISMISSED,
        moderatorNotes: 'No evidence found.',
        reason: 'Nothing to act on',
      });

      expect(reportRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ReportStatus.DISMISSED,
          moderatorNotes: 'No evidence found.',
          reviewedById: ADMIN_ID,
          reviewedAt: expect.any(Date),
        }),
      );
    });

    it('should log the decision with its reason (FC-039)', async () => {
      queryBuilder.getOne.mockResolvedValue(buildReport());

      await service.updateForAdmin('report-1', ADMIN_ID, {
        status: ReportStatus.DISMISSED,
        reason: 'Nothing to act on',
      });

      expect(logged).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.USER_REPORT_DECIDED,
          actorUserId: ADMIN_ID,
          targetUserId: REPORTED_ID,
          subjectKind: 'USER_REPORT',
          subjectId: 'report-1',
          reason: 'Nothing to act on',
          detail: { from: ReportStatus.OPEN, to: ReportStatus.DISMISSED },
        }),
      );
    });

    it('should log a report taken for review, which needs no reason', async () => {
      queryBuilder.getOne.mockResolvedValue(buildReport());

      await service.updateForAdmin('report-1', ADMIN_ID, {
        status: ReportStatus.UNDER_REVIEW,
      });

      expect(logged).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          reason: REPORT_MOVED_REASONS[ReportStatus.UNDER_REVIEW],
          detail: { from: ReportStatus.OPEN, to: ReportStatus.UNDER_REVIEW },
        }),
      );
    });

    it('should keep existing notes when the update supplies none', async () => {
      queryBuilder.getOne.mockResolvedValue(
        buildReport({ moderatorNotes: 'Earlier note' }),
      );

      await service.updateForAdmin('report-1', ADMIN_ID, {
        status: ReportStatus.ACTIONED,
        reason: 'Warned them',
      });

      expect(reportRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ moderatorNotes: 'Earlier note' }),
      );
    });

    it('should throw when no live report matches', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      await expect(
        service.updateForAdmin('report-1', ADMIN_ID, {
          status: ReportStatus.ACTIONED,
          reason: 'Warned them',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('countUnresolvedByReportedUser', () => {
    it('should return an empty map without querying for no members', async () => {
      await expect(service.countUnresolvedByReportedUser([])).resolves.toEqual(
        new Map(),
      );
      expect(reportRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should key the counts by reported member', async () => {
      queryBuilder.getRawMany.mockResolvedValue([
        { reportedId: REPORTED_ID, count: '3' },
      ]);

      const result = await service.countUnresolvedByReportedUser([REPORTED_ID]);

      expect(result.get(REPORTED_ID)).toBe(3);
    });
  });

  describe('actionReportsAgainst', () => {
    /**
     * The disabling's transaction, holding some open reports.
     *
     * @param members - Open member reports.
     * @param chats - Open chat reports.
     * @returns It.
     */
    const disabling = (members: unknown[], chats: unknown[]) => ({
      find: jest.fn((entity: unknown) =>
        Promise.resolve(entity === ChatMessageReportEntity ? chats : members),
      ),
      update: jest.fn(() => Promise.resolve({})),
      insert: jest.fn<(entity: unknown, row: unknown) => Promise<undefined>>(
        () => Promise.resolve(undefined),
      ),
    });

    it('should close every open report naming the member, each logged (FC-039)', async () => {
      const manager = disabling(
        [{ id: 'member-1', status: ReportStatus.OPEN }],
        [
          { id: 'chat-1', status: ReportStatus.OPEN },
          { id: 'chat-2', status: ReportStatus.UNDER_REVIEW },
        ],
      );

      await expect(
        service.actionReportsAgainst(
          manager as never,
          REPORTED_ID,
          ADMIN_ID,
          'Spamming',
        ),
      ).resolves.toBe(3);
      expect(manager.update).toHaveBeenCalledWith(
        UserReportEntity,
        { id: expect.anything() },
        expect.objectContaining({
          status: ReportStatus.ACTIONED,
          reviewedById: ADMIN_ID,
        }),
      );
      expect(manager.update).toHaveBeenCalledWith(
        ChatMessageReportEntity,
        { id: expect.anything() },
        expect.objectContaining({
          status: ReportStatus.ACTIONED,
          resolutionNote: 'Closed when the account was disabled.',
          resolvedByUserId: ADMIN_ID,
        }),
      );
      expect(manager.insert.mock.calls.map(([, row]) => row)).toEqual([
        expect.objectContaining({
          action: SiteAdminActionKind.USER_REPORT_DECIDED,
          subjectId: 'member-1',
          reason: 'Spamming',
          detail: {
            from: ReportStatus.OPEN,
            to: ReportStatus.ACTIONED,
            withDisabling: true,
          },
        }),
        expect.objectContaining({
          action: SiteAdminActionKind.CHAT_REPORT_DECIDED,
          subjectId: 'chat-1',
        }),
        expect.objectContaining({
          action: SiteAdminActionKind.CHAT_REPORT_DECIDED,
          subjectId: 'chat-2',
          detail: expect.objectContaining({
            from: ReportStatus.UNDER_REVIEW,
          }),
        }),
      ]);
    });

    it('should change nothing when nothing is open', async () => {
      const manager = disabling([], []);

      await expect(
        service.actionReportsAgainst(
          manager as never,
          REPORTED_ID,
          ADMIN_ID,
          'Spamming',
        ),
      ).resolves.toBe(0);
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.insert).not.toHaveBeenCalled();
    });
  });

  describe('linked queues (FC-036)', () => {
    it('counts the open chat reports about each reported member', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([
        [
          buildReport(),
          buildReport({ id: 'report-2', reportedId: 'reported-2' }),
        ],
        2,
      ]);
      reportRepository.manager.find.mockResolvedValue([
        { authorUserId: REPORTED_ID },
        { authorUserId: REPORTED_ID },
      ]);

      const page = await service.findForAdmin({});

      expect(page.items.map(item => item.openChatReportCount)).toEqual([2, 0]);
    });

    it('asks nothing of chat for an empty page', async () => {
      await service.findForAdmin({});

      expect(reportRepository.manager.find).not.toHaveBeenCalled();
    });

    it('counts the open chat reports', async () => {
      reportRepository.manager.count.mockResolvedValue(5);

      await expect(service.countUnresolvedChat()).resolves.toBe(5);
      expect(reportRepository.manager.count).toHaveBeenCalledWith(
        ChatMessageReportEntity,
        expect.anything(),
      );
    });
  });
});
