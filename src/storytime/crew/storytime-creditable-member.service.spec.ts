import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { UserProfileEntity } from '../../user/entities/user-profile.entity';
import { StorytimeStoryCollaboratorEntity } from './entities/storytime-story-collaborator.entity';
import { StorytimeCreditableMemberService } from './storytime-creditable-member.service';

/**
 * A chainable query-builder test double whose terminal methods are settable.
 */
interface MockQueryBuilder {
  innerJoin: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  take: jest.Mock;
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

  for (const method of ['innerJoin', 'where', 'andWhere', 'take'] as const) {
    queryBuilder[method] = jest.fn(() => queryBuilder);
  }

  queryBuilder.getOne = jest.fn(() => Promise.resolve(null as unknown));
  queryBuilder.getMany = jest.fn(() => Promise.resolve([] as unknown[]));

  return queryBuilder;
}

describe('StorytimeCreditableMemberService', () => {
  let service: StorytimeCreditableMemberService;
  let profileQb: MockQueryBuilder;
  let collaboratorRepository: {
    find: jest.Mock<() => Promise<{ userId: string }[]>>;
  };

  const storyId = 'e6d3a1b2-0000-4000-8000-0000000000aa';
  const memberId = 'e6d3a1b2-0000-4000-8000-000000000002';
  const otherMemberId = 'e6d3a1b2-0000-4000-8000-000000000003';

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
    collaboratorRepository = { find: jest.fn(() => Promise.resolve([])) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeCreditableMemberService,
        {
          provide: getRepositoryToken(UserProfileEntity),
          useValue: { createQueryBuilder: jest.fn(() => profileQb) },
        },
        {
          provide: getRepositoryToken(StorytimeStoryCollaboratorEntity),
          useValue: collaboratorRepository,
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

  describe('searching for somebody to credit', () => {
    it('matches part of a username, case-insensitively', async () => {
      profileQb.getMany.mockResolvedValue([profile()]);

      await expect(service.search(storyId, 'pic')).resolves.toEqual([
        {
          username: 'captain.picard',
          profilePicture100: null,
          isCollaborator: false,
        },
      ]);

      expect(conditions()).toContain('LOWER(profile.username) LIKE LOWER');
      expect(profileQb.andWhere).toHaveBeenCalledWith(expect.any(String), {
        term: '%pic%',
      });
    });

    // A credit says who somebody is, not where to find them. Returning the
    // user identifier would undo the rule the registry listing states.
    it('never answers with a user identifier', async () => {
      profileQb.getMany.mockResolvedValue([profile()]);

      const [found] = await service.search(storyId, 'pic');

      expect(found).not.toHaveProperty('userId');
    });

    it('leaves out members who are neither public nor on the Story', async () => {
      await service.search(storyId, 'pic');

      expect(conditions()).toContain('profile.publiclyVisible = true');
    });

    // Somebody already working on the Story has opted into being known to its
    // creator, and refusing to credit them because their public profile is off
    // would make the roll least accurate for the people who did the most.
    it('finds a private member who is working on the Story', async () => {
      collaboratorRepository.find.mockResolvedValue([{ userId: memberId }]);
      profileQb.getMany.mockResolvedValue([profile()]);

      const [found] = await service.search(storyId, 'pic');

      expect(found.isCollaborator).toBe(true);
      expect(conditions()).toContain(
        '(profile.publiclyVisible = true OR profile.userId IN (:...collaboratorIds))',
      );
    });

    it('puts the Story crew first, then sorts by name', async () => {
      collaboratorRepository.find.mockResolvedValue([
        { userId: otherMemberId },
      ]);
      profileQb.getMany.mockResolvedValue([
        profile({ username: 'aardvark' }),
        profile({ userId: otherMemberId, username: 'zoe' }),
      ]);

      const found = await service.search(storyId, 'a');

      expect(found.map(member => member.username)).toEqual(['zoe', 'aardvark']);
    });

    // Two members of equal standing still need a settled order, or the same
    // search would come back shuffled between one call and the next.
    it('sorts by name where neither is on the Story', async () => {
      profileQb.getMany.mockResolvedValue([
        profile({ username: 'zoe' }),
        profile({ userId: otherMemberId, username: 'aardvark' }),
      ]);

      const found = await service.search(storyId, 'a');

      expect(found.map(member => member.username)).toEqual(['aardvark', 'zoe']);
    });

    // Listing every public member would be a directory rather than a search.
    it('answers with nothing when there is neither a term nor a crew', async () => {
      await expect(service.search(storyId)).resolves.toEqual([]);
      expect(profileQb.getMany).not.toHaveBeenCalled();
    });

    it('answers with the crew when there is no term', async () => {
      collaboratorRepository.find.mockResolvedValue([{ userId: memberId }]);
      profileQb.getMany.mockResolvedValue([profile()]);

      const found = await service.search(storyId);

      expect(found).toHaveLength(1);
      expect(conditions()).toContain('profile.userId IN (:...collaboratorIds)');
    });
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
