import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { UserProfileEntity } from '../../user/entities/user-profile.entity';
import { StorytimeCreditableMemberService } from './storytime-creditable-member.service';

/**
 * A chainable query-builder test double whose terminal methods are settable.
 */
interface MockQueryBuilder {
  innerJoin: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  getOne: jest.Mock<() => Promise<unknown>>;
  getMany: jest.Mock<() => Promise<unknown[]>>;
}

/**
 * Builds a self-returning query-builder mock.
 *
 * @returns A chainable query-builder test double.
 */
function createQueryBuilderMock(): MockQueryBuilder {
  const queryBuilder = {} as MockQueryBuilder;

  for (const method of ['innerJoin', 'where', 'andWhere'] as const) {
    queryBuilder[method] = jest.fn(() => queryBuilder);
  }

  queryBuilder.getOne = jest.fn(() => Promise.resolve(null as unknown));
  queryBuilder.getMany = jest.fn(() => Promise.resolve([] as unknown[]));

  return queryBuilder;
}

describe('StorytimeCreditableMemberService', () => {
  let service: StorytimeCreditableMemberService;
  let profileQb: MockQueryBuilder;

  const memberId = 'e6d3a1b2-0000-4000-8000-000000000002';

  /**
   * Builds a profile fixture.
   *
   * @param overrides - Fields to change.
   * @returns A profile-shaped fixture.
   */
  const profile = (overrides: Partial<UserProfileEntity> = {}) =>
    ({
      userId: memberId,
      username: 'captain.picard',
      profilePicture100: null,
      ...overrides,
    }) as UserProfileEntity;

  /**
   * Reports every SQL fragment the query was narrowed by.
   *
   * @returns The `andWhere` conditions, joined.
   */
  const conditions = (): string =>
    profileQb.andWhere.mock.calls.map(call => String(call[0])).join(' | ');

  beforeEach(async () => {
    profileQb = createQueryBuilderMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeCreditableMemberService,
        {
          provide: getRepositoryToken(UserProfileEntity),
          useValue: { createQueryBuilder: jest.fn(() => profileQb) },
        },
      ],
    }).compile();

    service = module.get<StorytimeCreditableMemberService>(
      StorytimeCreditableMemberService,
    );
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolving a username', () => {
    it('answers with the member it belongs to', async () => {
      profileQb.getOne.mockResolvedValue(profile());

      await expect(service.requireUserId('captain.picard')).resolves.toBe(
        memberId,
      );
    });

    // Deliberately not restricted to public profiles: somebody who has gone
    // private since the credit was agreed still did the work.
    it('resolves a member whose profile is not public', async () => {
      profileQb.getOne.mockResolvedValue(profile());

      await service.requireUserId('captain.picard');

      expect(conditions()).not.toContain('publiclyVisible');
    });

    // The name came from a form field, and what is wrong is what was typed.
    it('refuses a username nobody has', async () => {
      profileQb.getOne.mockResolvedValue(null);

      await expect(service.requireUserId('nobody')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('reading usernames back', () => {
    it('maps each member to their name', async () => {
      profileQb.getMany.mockResolvedValue([profile()]);

      await expect(service.findUsernames([memberId])).resolves.toEqual(
        new Map([[memberId, 'captain.picard']]),
      );
    });

    // A credit for somebody who has closed their account comes back
    // unattributed rather than pointing at a member who is not there.
    it('leaves out a member who is no longer here', async () => {
      profileQb.getMany.mockResolvedValue([]);

      await expect(service.findUsernames([memberId])).resolves.toEqual(
        new Map(),
      );
    });

    it('asks the database nothing when given nobody', async () => {
      await expect(service.findUsernames([])).resolves.toEqual(new Map());
      expect(profileQb.getMany).not.toHaveBeenCalled();
    });
  });
});
