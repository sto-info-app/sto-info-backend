import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ArcMembershipStatus } from '../enums/arc-membership-status.enum';
import { StorytimeActivityType } from '../enums/storytime-activity-type.enum';
import { StorytimeActivityFeedService } from '../social/storytime-activity-feed.service';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcMembershipService } from './storytime-arc-membership.service';
import { StorytimeArcService } from './storytime-arc.service';

describe('StorytimeArcMembershipService', () => {
  let service: StorytimeArcMembershipService;
  let membershipRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let arcService: {
    findOwnedOrFail: jest.Mock;
    findEditableOrFail: jest.Mock;
    nextOrderIndex: jest.Mock;
  };
  let storyService: { findOwnedOrFail: jest.Mock };
  let feedService: { recordQuietly: jest.Mock };

  const curatorId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const authorId = 'e6d3a1b2-0000-4000-8000-000000000002';
  const strangerId = 'e6d3a1b2-0000-4000-8000-000000000003';
  const arcId = 'e6d3a1b2-0000-4000-8000-0000000000aa';
  const storyId = 'e6d3a1b2-0000-4000-8000-0000000000bb';
  const membershipId = 'e6d3a1b2-0000-4000-8000-0000000000cc';

  /**
   * Builds a membership.
   *
   * @param overrides - Fields to change.
   * @returns The membership entity.
   */
  const buildMembership = (
    overrides: Partial<StorytimeArcStoryEntity> = {},
  ): StorytimeArcStoryEntity =>
    Object.assign(new StorytimeArcStoryEntity(), {
      id: membershipId,
      arcId,
      storyId,
      orderIndex: 1000,
      membershipStatus: ArcMembershipStatus.INVITED,
      requestedByUserId: curatorId,
      approvedByUserId: null,
      requestedAt: new Date(),
      approvedAt: null,
      declinedAt: null,
      removedAt: null,
      introductoryNote: null,
      ...overrides,
    });

  /**
   * Arranges who curates the Arc and who owns the Story.
   *
   * @param options - Which side each caller is on.
   */
  const arrangeOwnership = (options: {
    curator?: string;
    author?: string;
  }): void => {
    const curates = (user: string) =>
      user === (options.curator ?? curatorId)
        ? Promise.resolve({ id: arcId })
        : Promise.reject(new ForbiddenException());

    arcService.findOwnedOrFail.mockImplementation((_arc, user) =>
      curates(user),
    );
    arcService.findEditableOrFail.mockImplementation((_arc, user) =>
      curates(user),
    );
    storyService.findOwnedOrFail.mockImplementation((_story, user) =>
      user === (options.author ?? authorId)
        ? Promise.resolve({ id: storyId })
        : Promise.reject(new ForbiddenException()),
    );
  };

  beforeEach(async () => {
    membershipRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(() => new StorytimeArcStoryEntity()),
      save: jest.fn(input => Promise.resolve(input)),
    };
    arcService = {
      findOwnedOrFail: jest.fn().mockResolvedValue({ id: arcId }),
      findEditableOrFail: jest.fn().mockResolvedValue({ id: arcId }),
      nextOrderIndex: jest.fn().mockReturnValue(1000),
    };
    storyService = {
      findOwnedOrFail: jest.fn().mockResolvedValue({ id: storyId }),
    };
    feedService = { recordQuietly: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeArcMembershipService,
        {
          provide: getRepositoryToken(StorytimeArcStoryEntity),
          useValue: membershipRepository,
        },
        { provide: StorytimeArcService, useValue: arcService },
        { provide: StorytimeStoryService, useValue: storyService },
        { provide: StorytimeActivityFeedService, useValue: feedService },
      ],
    }).compile();

    service = module.get<StorytimeArcMembershipService>(
      StorytimeArcMembershipService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  // Inclusion is agreed by both sides. Which side still has to agree depends
  // on who started it — that symmetry is the whole point of the workflow.
  describe('opening a membership', () => {
    // Two different people either side, which is the case the agreement
    // exists for.
    beforeEach(() => {
      arrangeOwnership({});
    });

    it('leaves a curator’s invitation waiting on the Story owner', async () => {
      const membership = await service.invite(arcId, storyId, curatorId);

      expect(membership.membershipStatus).toBe(ArcMembershipStatus.INVITED);
      expect(membership.requestedByUserId).toBe(curatorId);
      expect(membership.approvedByUserId).toBeNull();
      expect(membership.approvedAt).toBeNull();
    });

    it('leaves an owner’s request waiting on the curator', async () => {
      const membership = await service.request(arcId, storyId, authorId);

      expect(membership.membershipStatus).toBe(ArcMembershipStatus.REQUESTED);
    });

    it('announces nothing while a membership is still waiting', async () => {
      await service.invite(arcId, storyId, curatorId);

      expect(feedService.recordQuietly).not.toHaveBeenCalled();
    });

    it('refuses an invitation from somebody who does not curate the Arc', async () => {
      await expect(service.invite(arcId, storyId, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses a request from somebody who does not own the Story', async () => {
      await expect(service.request(arcId, storyId, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it.each([
      ArcMembershipStatus.INVITED,
      ArcMembershipStatus.REQUESTED,
      ArcMembershipStatus.APPROVED,
    ])('refuses a second membership while one is %s', async status => {
      membershipRepository.findOne.mockResolvedValue(
        buildMembership({ membershipStatus: status }),
      );

      await expect(service.invite(arcId, storyId, curatorId)).rejects.toThrow(
        /already in this Arc/,
      );
    });

    // Falling out and making up should not need an administrator to undo the
    // unique constraint.
    it.each([
      ArcMembershipStatus.DECLINED,
      ArcMembershipStatus.REMOVED,
      ArcMembershipStatus.WITHDRAWN,
    ])('reopens a membership that previously ended as %s', async status => {
      membershipRepository.findOne.mockResolvedValue(
        buildMembership({ membershipStatus: status, removedAt: new Date() }),
      );

      const membership = await service.invite(arcId, storyId, curatorId);

      expect(membership.membershipStatus).toBe(ArcMembershipStatus.INVITED);
      expect(membership.removedAt).toBeNull();
      expect(membershipRepository.create).not.toHaveBeenCalled();
    });

    // A Story invited back should not jump the queue it was already in.
    it('keeps the position a reopened membership already had', async () => {
      membershipRepository.findOne.mockResolvedValue(
        buildMembership({
          membershipStatus: ArcMembershipStatus.REMOVED,
          orderIndex: 5000,
        }),
      );

      const membership = await service.invite(arcId, storyId, curatorId);

      expect(membership.orderIndex).toBe(5000);
    });
  });

  // The agreement protects somebody from having their work taken into an Arc
  // they did not choose. When one person is both sides there is nobody to
  // protect, and an invitation they would answer themselves is a step for its
  // own sake.
  describe('opening a membership with nobody else to ask', () => {
    beforeEach(() => {
      arrangeOwnership({ curator: curatorId, author: curatorId });
    });

    it('joins a Story the curator wrote themselves', async () => {
      const membership = await service.invite(arcId, storyId, curatorId);

      expect(membership.membershipStatus).toBe(ArcMembershipStatus.APPROVED);
      expect(membership.approvedByUserId).toBe(curatorId);
      expect(membership.approvedAt).toBeInstanceOf(Date);
    });

    it('joins when the Story owner curates the Arc as well', async () => {
      const membership = await service.request(arcId, storyId, curatorId);

      expect(membership.membershipStatus).toBe(ArcMembershipStatus.APPROVED);
      expect(membership.approvedByUserId).toBe(curatorId);
    });

    // A Story joining is worth announcing however it got there, so somebody
    // following the Arc hears about it either way.
    it('announces the Story joining', async () => {
      await service.invite(arcId, storyId, curatorId);

      expect(feedService.recordQuietly).toHaveBeenCalledWith(
        StorytimeActivityType.ARC_STORY_ADDED,
        curatorId,
        { arcId, storyId },
      );
    });
  });

  describe('answering', () => {
    describe('an invitation from the curator', () => {
      beforeEach(() => {
        arrangeOwnership({});
        membershipRepository.findOne.mockResolvedValue(
          buildMembership({ membershipStatus: ArcMembershipStatus.INVITED }),
        );
      });

      it('is the Story owner’s to accept', async () => {
        const membership = await service.approve(membershipId, authorId);

        expect(membership.membershipStatus).toBe(ArcMembershipStatus.APPROVED);
        expect(membership.approvedByUserId).toBe(authorId);
        expect(membership.approvedAt).toBeInstanceOf(Date);
      });

      it('announces the Story joining the Arc', async () => {
        await service.approve(membershipId, authorId);

        expect(feedService.recordQuietly).toHaveBeenCalledWith(
          StorytimeActivityType.ARC_STORY_ADDED,
          authorId,
          { arcId, storyId },
        );
      });

      it('is the Story owner’s to decline', async () => {
        const membership = await service.decline(membershipId, authorId);

        expect(membership.membershipStatus).toBe(ArcMembershipStatus.DECLINED);
      });

      // Accepting your own invitation would make the agreement meaningless.
      it('is not the curator’s to accept', async () => {
        await expect(service.approve(membershipId, curatorId)).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('is not a stranger’s to accept', async () => {
        await expect(service.approve(membershipId, strangerId)).rejects.toThrow(
          ForbiddenException,
        );
      });
    });

    describe('a request from the Story owner', () => {
      beforeEach(() => {
        arrangeOwnership({});
        membershipRepository.findOne.mockResolvedValue(
          buildMembership({
            membershipStatus: ArcMembershipStatus.REQUESTED,
            requestedByUserId: authorId,
          }),
        );
      });

      it('is the curator’s to accept', async () => {
        const membership = await service.approve(membershipId, curatorId);

        expect(membership.membershipStatus).toBe(ArcMembershipStatus.APPROVED);
      });

      // Accepting your own request would be the same problem the other way up.
      it('is not the Story owner’s to accept', async () => {
        await expect(service.approve(membershipId, authorId)).rejects.toThrow(
          ForbiddenException,
        );
      });
    });

    it.each([
      ArcMembershipStatus.APPROVED,
      ArcMembershipStatus.DECLINED,
      ArcMembershipStatus.REMOVED,
      ArcMembershipStatus.WITHDRAWN,
    ])('refuses to answer something already %s', async status => {
      membershipRepository.findOne.mockResolvedValue(
        buildMembership({ membershipStatus: status }),
      );

      await expect(service.approve(membershipId, authorId)).rejects.toThrow(
        /already been answered/,
      );
    });

    it('reports a membership that does not exist', async () => {
      membershipRepository.findOne.mockResolvedValue(null);

      await expect(service.approve(membershipId, authorId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // A curator dropping a Story and an owner pulling theirs out are different
  // things, and a Story that left of its own accord should not read as having
  // been rejected.
  describe('leaving', () => {
    beforeEach(() => {
      arrangeOwnership({});
      membershipRepository.findOne.mockResolvedValue(
        buildMembership({ membershipStatus: ArcMembershipStatus.APPROVED }),
      );
    });

    it('records a curator dropping a Story as removed', async () => {
      const membership = await service.leave(membershipId, curatorId);

      expect(membership.membershipStatus).toBe(ArcMembershipStatus.REMOVED);
      expect(membership.removedAt).toBeInstanceOf(Date);
    });

    it('announces the Story leaving the Arc', async () => {
      await service.leave(membershipId, curatorId);

      expect(feedService.recordQuietly).toHaveBeenCalledWith(
        StorytimeActivityType.ARC_STORY_REMOVED,
        curatorId,
        { arcId, storyId },
      );
    });

    it('records an owner pulling out as withdrawn', async () => {
      const membership = await service.leave(membershipId, authorId);

      expect(membership.membershipStatus).toBe(ArcMembershipStatus.WITHDRAWN);
    });

    it('refuses somebody on neither side', async () => {
      await expect(service.leave(membershipId, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('reading', () => {
    it('lists only agreed memberships for a reader', async () => {
      await service.findApprovedByArc(arcId);

      expect(membershipRepository.find).toHaveBeenCalledWith({
        where: { arcId, membershipStatus: ArcMembershipStatus.APPROVED },
        order: { orderIndex: 'ASC' },
      });
    });

    it('lists everything for the curator', async () => {
      await service.findByArcForCurator(arcId, curatorId);

      expect(membershipRepository.find).toHaveBeenCalledWith({
        where: { arcId },
        order: { orderIndex: 'ASC' },
      });
    });

    it('refuses to list an Arc the caller does not curate', async () => {
      arcService.findOwnedOrFail.mockRejectedValue(new ForbiddenException());
      arcService.findEditableOrFail.mockRejectedValue(new ForbiddenException());

      await expect(
        service.findByArcForCurator(arcId, strangerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lists the Arcs a Story has agreed to be in', async () => {
      await service.findApprovedByStory(storyId);

      expect(membershipRepository.find).toHaveBeenCalledWith({
        where: { storyId, membershipStatus: ArcMembershipStatus.APPROVED },
      });
    });

    // Both directions at once: invitations to their Stories and requests to
    // their Arcs are the same kind of thing to the person answering.
    describe('what is waiting on somebody', () => {
      it('asks about both sides', async () => {
        await service.findPendingForUser([storyId], [arcId]);

        expect(membershipRepository.find).toHaveBeenCalledWith(
          expect.objectContaining({
            where: [
              expect.objectContaining({
                membershipStatus: ArcMembershipStatus.INVITED,
              }),
              expect.objectContaining({
                membershipStatus: ArcMembershipStatus.REQUESTED,
              }),
            ],
          }),
        );
      });

      it('asks only about Stories when they curate nothing', async () => {
        await service.findPendingForUser([storyId], []);

        const clauses = membershipRepository.find.mock.calls[0][0].where;
        expect(clauses).toHaveLength(1);
      });

      it('asks only about Arcs when they own no Stories', async () => {
        await service.findPendingForUser([], [arcId]);

        const clauses = membershipRepository.find.mock.calls[0][0].where;
        expect(clauses).toHaveLength(1);
      });

      // Asking the database for nothing would return every membership.
      it('asks for nothing when they have neither', async () => {
        await expect(service.findPendingForUser([], [])).resolves.toEqual([]);
        expect(membershipRepository.find).not.toHaveBeenCalled();
      });
    });
  });

  describe('reordering', () => {
    const first = buildMembership({
      id: 'a',
      orderIndex: 1000,
      membershipStatus: ArcMembershipStatus.APPROVED,
    });
    const second = buildMembership({
      id: 'b',
      orderIndex: 2000,
      membershipStatus: ArcMembershipStatus.APPROVED,
    });

    beforeEach(() => {
      membershipRepository.find.mockResolvedValue([first, second]);
    });

    it('renumbers into the given order', async () => {
      const reordered = await service.reorder(arcId, ['b', 'a'], curatorId);

      expect(reordered.map(membership => membership.id)).toEqual(['b', 'a']);
      expect(reordered[0].orderIndex).toBeLessThan(reordered[1].orderIndex);
    });

    it.each([
      ['a partial order', ['a']],
      ['a repeated Story', ['a', 'a']],
      ['a Story from elsewhere', ['a', 'z']],
    ])('refuses %s', async (_name, membershipIds) => {
      await expect(
        service.reorder(arcId, membershipIds, curatorId),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses somebody who does not curate the Arc', async () => {
      arcService.findOwnedOrFail.mockRejectedValue(new ForbiddenException());
      arcService.findEditableOrFail.mockRejectedValue(new ForbiddenException());

      await expect(
        service.reorder(arcId, ['a', 'b'], strangerId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
