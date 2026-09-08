import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ArcMembershipStatus } from '../enums/arc-membership-status.enum';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';
import { StorytimeStoryArcsService } from './storytime-story-arcs.service';

describe('StorytimeStoryArcsService', () => {
  let service: StorytimeStoryArcsService;
  let membershipRepository: { find: jest.Mock };
  let arcRepository: { find: jest.Mock };

  const storyId = 'story-1';
  const otherStoryId = 'story-2';

  /**
   * Builds an Arc membership.
   *
   * @param overrides - Fields to change.
   * @returns The membership entity.
   */
  const buildMembership = (
    overrides: Partial<StorytimeArcStoryEntity> = {},
  ): StorytimeArcStoryEntity =>
    Object.assign(new StorytimeArcStoryEntity(), {
      id: 'membership-1',
      arcId: 'arc-1',
      storyId,
      orderIndex: 1000,
      membershipStatus: ArcMembershipStatus.APPROVED,
      ...overrides,
    });

  /**
   * Builds an Arc.
   *
   * @param overrides - Fields to change.
   * @returns The Arc entity.
   */
  const buildArc = (
    overrides: Partial<StorytimeArcEntity> = {},
  ): StorytimeArcEntity =>
    Object.assign(new StorytimeArcEntity(), {
      id: 'arc-1',
      slug: 'the-dominion-trilogy',
      title: 'The Dominion Trilogy',
      ...overrides,
    });

  beforeEach(async () => {
    membershipRepository = { find: jest.fn().mockResolvedValue([]) };
    arcRepository = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeStoryArcsService,
        {
          provide: getRepositoryToken(StorytimeArcStoryEntity),
          useValue: membershipRepository,
        },
        {
          provide: getRepositoryToken(StorytimeArcEntity),
          useValue: arcRepository,
        },
      ],
    }).compile();

    service = module.get<StorytimeStoryArcsService>(StorytimeStoryArcsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('findForStories', () => {
    it('names the Arc a Story is read as part of', async () => {
      membershipRepository.find.mockResolvedValue([buildMembership()]);
      arcRepository.find.mockResolvedValue([buildArc()]);

      const result = await service.findForStories([storyId]);

      expect(result.get(storyId)).toEqual([
        {
          id: 'arc-1',
          title: 'The Dominion Trilogy',
          slug: 'the-dominion-trilogy',
        },
      ]);
    });

    // Inclusion is agreed by both sides, so an invitation nobody has answered
    // is not yet a fact about the Story.
    it('asks only for agreed memberships', async () => {
      await service.findForStories([storyId]);

      expect(membershipRepository.find).toHaveBeenCalledWith({
        where: {
          storyId: expect.anything(),
          membershipStatus: ArcMembershipStatus.APPROVED,
        },
      });
    });

    // An unlisted Arc is one its curator chose not to advertise. A Story
    // listing naming it would advertise it on their behalf.
    it('asks only for Arcs anybody may browse', async () => {
      membershipRepository.find.mockResolvedValue([buildMembership()]);

      await service.findForStories([storyId]);

      expect(arcRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            visibility: 'PUBLIC',
            moderationStatus: 'ACTIVE',
          }),
        }),
      );
    });

    // By title, so a Story in several Arcs names them the same way every time
    // rather than in whatever order its memberships came back in.
    it('gives a Story in several Arcs all of them, by title', async () => {
      membershipRepository.find.mockResolvedValue([
        buildMembership({ id: 'membership-2', arcId: 'arc-2' }),
        buildMembership(),
      ]);
      arcRepository.find.mockResolvedValue([
        buildArc(),
        buildArc({ id: 'arc-2', slug: 'the-second', title: 'A Second Arc' }),
      ]);

      const result = await service.findForStories([storyId]);

      expect(result.get(storyId)?.map(arc => arc.title)).toEqual([
        'A Second Arc',
        'The Dominion Trilogy',
      ]);
    });

    it('keys each Arc against every Story that is in it', async () => {
      membershipRepository.find.mockResolvedValue([
        buildMembership(),
        buildMembership({ id: 'membership-2', storyId: otherStoryId }),
      ]);
      arcRepository.find.mockResolvedValue([buildArc()]);

      const result = await service.findForStories([storyId, otherStoryId]);

      expect(result.get(storyId)).toHaveLength(1);
      expect(result.get(otherStoryId)).toHaveLength(1);
    });

    // A membership naming an Arc that has since been unpublished is a real
    // agreement, but not one a reader may act on.
    it('drops a membership whose Arc is no longer browsable', async () => {
      membershipRepository.find.mockResolvedValue([buildMembership()]);
      arcRepository.find.mockResolvedValue([]);

      const result = await service.findForStories([storyId]);

      expect(result.size).toBe(0);
    });

    it('asks for nothing when there are no Stories', async () => {
      const result = await service.findForStories([]);

      expect(result.size).toBe(0);
      expect(membershipRepository.find).not.toHaveBeenCalled();
    });

    it('ignores repeats and blanks', async () => {
      await service.findForStories([storyId, storyId, '']);

      expect(membershipRepository.find).toHaveBeenCalledWith({
        where: {
          storyId: expect.objectContaining({ value: [storyId] }),
          membershipStatus: ArcMembershipStatus.APPROVED,
        },
      });
    });

    // No memberships means no Arcs, and asking after them would be a query
    // whose answer is already known.
    it('does not look for Arcs when nothing is in one', async () => {
      const result = await service.findForStories([storyId]);

      expect(result.size).toBe(0);
      expect(arcRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('findForStory', () => {
    it('names the Arcs one Story is read as part of', async () => {
      membershipRepository.find.mockResolvedValue([buildMembership()]);
      arcRepository.find.mockResolvedValue([buildArc()]);

      await expect(service.findForStory(storyId)).resolves.toEqual([
        {
          id: 'arc-1',
          title: 'The Dominion Trilogy',
          slug: 'the-dominion-trilogy',
        },
      ]);
    });

    it('answers with nothing for a Story in no Arc', async () => {
      await expect(service.findForStory(storyId)).resolves.toEqual([]);
    });
  });
});
