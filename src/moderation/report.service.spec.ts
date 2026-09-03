import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { PublicMemberService } from '../community/public-member.service';
import { UserReportEntity } from './entities/user-report.entity';
import { ReportReason } from './enums/report-reason.enum';
import { ReportStatus } from './enums/report-status.enum';
import { ReportService } from './report.service';

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
  };
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
    };
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

    it('should keep existing notes when the update supplies none', async () => {
      queryBuilder.getOne.mockResolvedValue(
        buildReport({ moderatorNotes: 'Earlier note' }),
      );

      await service.updateForAdmin('report-1', ADMIN_ID, {
        status: ReportStatus.ACTIONED,
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
    it('should close every unresolved report naming the member', async () => {
      reportRepository.update.mockResolvedValue({ affected: 2 });

      await expect(
        service.actionReportsAgainst(REPORTED_ID, ADMIN_ID),
      ).resolves.toBe(2);
      expect(reportRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ reportedId: REPORTED_ID }),
        expect.objectContaining({
          status: ReportStatus.ACTIONED,
          reviewedById: ADMIN_ID,
        }),
      );
    });

    it('should report zero when the driver gives no affected count', async () => {
      reportRepository.update.mockResolvedValue({});

      await expect(
        service.actionReportsAgainst(REPORTED_ID, ADMIN_ID),
      ).resolves.toBe(0);
    });
  });
});
