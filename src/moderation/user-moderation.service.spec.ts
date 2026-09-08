import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { UserRefreshTokenService } from '../user-refresh-token/user-refresh-token.service';
import { UserEntity } from '../user/entities/user.entity';
import { UserRole } from '../user/enums/user-role.enum';
import { ReportService } from './report.service';
import { UserModerationService } from './user-moderation.service';

const ADMIN_ID = 'admin-1';
const MEMBER_ID = 'member-1';

/**
 * A chainable query-builder test double whose terminal methods are settable.
 */
interface MockQueryBuilder {
  leftJoinAndSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getManyAndCount: jest.Mock<() => Promise<[UserEntity[], number]>>;
}

/**
 * Builds a self-returning query-builder mock.
 *
 * @returns A chainable query-builder test double.
 */
function createQueryBuilderMock(): MockQueryBuilder {
  const queryBuilder = {} as MockQueryBuilder;

  for (const method of [
    'leftJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'skip',
    'take',
  ] as const) {
    queryBuilder[method] = jest.fn(() => queryBuilder);
  }

  queryBuilder.getManyAndCount = jest.fn(() =>
    Promise.resolve([[], 0] as [UserEntity[], number]),
  );

  return queryBuilder;
}

/**
 * Builds a member fixture with their profile joined in.
 *
 * @param overrides - Fields to override on the fixture.
 * @returns A user-shaped test fixture.
 */
function buildUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: MEMBER_ID,
    email: 'member@example.com',
    role: UserRole.USER,
    isAccountDisabled: false,
    disabledAt: null,
    disabledReason: null,
    disabledById: null,
    lastLoginAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-14T09:21:00.000Z'),
    profile: { username: 'member' },
    ...overrides,
  } as UserEntity;
}

describe('UserModerationService', () => {
  let service: UserModerationService;
  let queryBuilder: MockQueryBuilder;
  let userRepository: {
    findOne: jest.Mock<() => Promise<UserEntity | null>>;
    save: jest.Mock<(entity: unknown) => Promise<UserEntity>>;
    createQueryBuilder: jest.Mock;
  };
  let refreshTokenService: { revokeAllTokensForUser: jest.Mock };
  let reportService: {
    countUnresolvedByReportedUser: jest.Mock<
      () => Promise<Map<string, number>>
    >;
    actionReportsAgainst: jest.Mock<() => Promise<number>>;
  };

  beforeEach(async () => {
    queryBuilder = createQueryBuilderMock();

    userRepository = {
      findOne: jest.fn(() => Promise.resolve(buildUser())),
      save: jest.fn((entity: unknown) => Promise.resolve(entity as UserEntity)),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    refreshTokenService = {
      revokeAllTokensForUser: jest.fn(() => Promise.resolve(undefined)),
    };
    reportService = {
      countUnresolvedByReportedUser: jest.fn(() =>
        Promise.resolve(new Map<string, number>()),
      ),
      actionReportsAgainst: jest.fn(() => Promise.resolve(0)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserModerationService,
        { provide: getRepositoryToken(UserEntity), useValue: userRepository },
        {
          provide: UserRefreshTokenService,
          useValue: refreshTokenService,
        },
        { provide: ReportService, useValue: reportService },
      ],
    }).compile();

    service = module.get<UserModerationService>(UserModerationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findUsers', () => {
    it('should page members newest first', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[buildUser()], 1]);

      const result = await service.findUsers({ page: 3, pageSize: 5 });

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'user.createdAt',
        'DESC',
      );
      expect(queryBuilder.skip).toHaveBeenCalledWith(10);
      expect(queryBuilder.take).toHaveBeenCalledWith(5);
      expect(result.total).toBe(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: MEMBER_ID,
          email: 'member@example.com',
          username: 'member',
          openReportCount: 0,
        }),
      );
    });

    it('should match the search term against email or username', async () => {
      await service.findUsers({ search: 'picard' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('profile.username'),
        { search: '%picard%' },
      );
    });

    it('should filter to active members when asked for them', async () => {
      await service.findUsers({ disabled: false });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'user.isAccountDisabled = :disabled',
        { disabled: false },
      );
    });

    it('should leave the state filter off when none is asked for', async () => {
      await service.findUsers({});

      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should cap the page size', async () => {
      await service.findUsers({ pageSize: 500 });

      expect(queryBuilder.take).toHaveBeenCalledWith(50);
    });

    it('should attach the unresolved report count to each member', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[buildUser()], 1]);
      reportService.countUnresolvedByReportedUser.mockResolvedValue(
        new Map([[MEMBER_ID, 4]]),
      );

      const result = await service.findUsers({});

      expect(result.items[0].openReportCount).toBe(4);
    });

    it('should fall back to no username when the member has no profile', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([
        [buildUser({ profile: undefined as never })],
        1,
      ]);

      const result = await service.findUsers({});

      expect(result.items[0].username).toBeNull();
    });
  });

  describe('findUser', () => {
    it('should throw when no such member exists', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.findUser(MEMBER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return the mapped member', async () => {
      await expect(service.findUser(MEMBER_ID)).resolves.toEqual(
        expect.objectContaining({ id: MEMBER_ID, username: 'member' }),
      );
    });
  });

  describe('disableUser', () => {
    it('should refuse an administrator disabling themselves', async () => {
      await expect(service.disableUser(ADMIN_ID, ADMIN_ID, {})).rejects.toThrow(
        BadRequestException,
      );
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('should refuse disabling another administrator', async () => {
      userRepository.findOne.mockResolvedValue(
        buildUser({ role: UserRole.ADMIN }),
      );

      await expect(
        service.disableUser(MEMBER_ID, ADMIN_ID, {}),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('should throw when no such member exists', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.disableUser(MEMBER_ID, ADMIN_ID, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should record the lock, the reason and who applied it', async () => {
      await service.disableUser(MEMBER_ID, ADMIN_ID, { reason: 'Spamming' });

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          isAccountDisabled: true,
          disabledReason: 'Spamming',
          disabledById: ADMIN_ID,
          disabledAt: expect.any(Date),
        }),
      );
    });

    it('should default the reason to null when none is given', async () => {
      await service.disableUser(MEMBER_ID, ADMIN_ID, {});

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ disabledReason: null }),
      );
    });

    it('should end the member live sessions', async () => {
      await service.disableUser(MEMBER_ID, ADMIN_ID, {});

      expect(refreshTokenService.revokeAllTokensForUser).toHaveBeenCalledWith(
        MEMBER_ID,
      );
    });

    it('should close the reports that led there', async () => {
      reportService.actionReportsAgainst.mockResolvedValue(2);

      await service.disableUser(MEMBER_ID, ADMIN_ID, {});

      expect(reportService.actionReportsAgainst).toHaveBeenCalledWith(
        MEMBER_ID,
        ADMIN_ID,
      );
    });
  });

  describe('enableUser', () => {
    it('should refuse an administrator restoring themselves', async () => {
      await expect(service.enableUser(ADMIN_ID, ADMIN_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should refuse restoring another administrator', async () => {
      userRepository.findOne.mockResolvedValue(
        buildUser({ role: UserRole.ADMIN }),
      );

      await expect(service.enableUser(MEMBER_ID, ADMIN_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should clear the lock and everything recorded with it', async () => {
      userRepository.findOne.mockResolvedValue(
        buildUser({
          isAccountDisabled: true,
          disabledAt: new Date('2026-08-02T00:00:00.000Z'),
          disabledReason: 'Spamming',
          disabledById: ADMIN_ID,
        }),
      );

      await service.enableUser(MEMBER_ID, ADMIN_ID);

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          isAccountDisabled: false,
          disabledAt: null,
          disabledReason: null,
          disabledById: null,
        }),
      );
    });

    it('should leave closed reports closed', async () => {
      await service.enableUser(MEMBER_ID, ADMIN_ID);

      expect(reportService.actionReportsAgainst).not.toHaveBeenCalled();
    });
  });
});
