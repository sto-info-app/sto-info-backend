import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeReaction } from '../enums/storytime-reaction.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeReactionEntity } from './entities/storytime-reaction.entity';
import { StorytimeReactionService } from './storytime-reaction.service';

describe('StorytimeReactionService', () => {
  let service: StorytimeReactionService;
  let reactionRepository: { find: jest.Mock; findOne: jest.Mock };
  let manager: {
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    update: jest.Mock;
  };

  const readerId = 'reader-1';
  const storyId = 'story-1';

  /**
   * Builds a reaction row.
   *
   * @param overrides - Fields to change.
   * @returns The reaction.
   */
  const buildReaction = (
    overrides: Partial<StorytimeReactionEntity> = {},
  ): StorytimeReactionEntity =>
    Object.assign(new StorytimeReactionEntity(), {
      id: 'reaction-1',
      userId: readerId,
      targetType: StorytimeTargetType.STORY,
      targetId: storyId,
      reaction: StorytimeReaction.THUMBS_UP,
      ...overrides,
    });

  beforeEach(async () => {
    reactionRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    manager = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(input => Promise.resolve(input)),
      create: jest.fn((_entity, input) =>
        Object.assign(new StorytimeReactionEntity(), input),
      ),
      delete: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeReactionService,
        {
          provide: getRepositoryToken(StorytimeReactionEntity),
          useValue: reactionRepository,
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
              work(manager),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<StorytimeReactionService>(StorytimeReactionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('reacting', () => {
    it('records a reaction', async () => {
      await service.react(
        StorytimeTargetType.STORY,
        storyId,
        StorytimeReaction.THUMBS_UP,
        readerId,
      );

      expect(manager.save).toHaveBeenCalledWith(
        StorytimeReactionEntity,
        expect.objectContaining({
          userId: readerId,
          reaction: StorytimeReaction.THUMBS_UP,
        }),
      );
    });

    // At most one reaction per person per item: changing your mind is an
    // update rather than a second vote.
    it('changes an existing reaction rather than adding another', async () => {
      reactionRepository.findOne.mockResolvedValue(buildReaction());

      await service.react(
        StorytimeTargetType.STORY,
        storyId,
        StorytimeReaction.THUMBS_DOWN,
        readerId,
      );

      expect(manager.save).toHaveBeenCalledWith(
        StorytimeReactionEntity,
        expect.objectContaining({
          id: 'reaction-1',
          reaction: StorytimeReaction.THUMBS_DOWN,
        }),
      );
    });

    // A pressed button pressed again means "undo".
    it('takes the reaction back when the same one is sent twice', async () => {
      reactionRepository.findOne.mockResolvedValue(buildReaction());

      await service.react(
        StorytimeTargetType.STORY,
        storyId,
        StorytimeReaction.THUMBS_UP,
        readerId,
      );

      expect(manager.delete).toHaveBeenCalledWith(StorytimeReactionEntity, {
        userId: readerId,
        targetType: StorytimeTargetType.STORY,
        targetId: storyId,
      });
    });

    // Counted from the rows rather than incremented, so a count that has
    // drifted is repaired the next time anybody reacts.
    it('writes the counts back from the rows', async () => {
      manager.find.mockResolvedValue([
        buildReaction(),
        buildReaction({ id: 'reaction-2', userId: 'reader-2' }),
        buildReaction({
          id: 'reaction-3',
          userId: 'reader-3',
          reaction: StorytimeReaction.THUMBS_DOWN,
        }),
      ]);

      await service.react(
        StorytimeTargetType.STORY,
        storyId,
        StorytimeReaction.THUMBS_UP,
        readerId,
      );

      expect(manager.update).toHaveBeenCalledWith(
        StorytimeStoryEntity,
        { id: storyId },
        { upVoteCount: 2, downVoteCount: 1 },
      );
    });

    it.each([
      ['a Chapter', StorytimeTargetType.CHAPTER, StorytimeChapterEntity],
      ['an Arc', StorytimeTargetType.ARC, StorytimeArcEntity],
    ])('counts %s on its own table', async (_name, targetType, entity) => {
      await service.react(
        targetType,
        'target-1',
        StorytimeReaction.THUMBS_UP,
        readerId,
      );

      expect(manager.update).toHaveBeenCalledWith(
        entity,
        { id: 'target-1' },
        expect.anything(),
      );
    });

    // A Character is part of somebody's Story rather than a thing to approve
    // of on its own.
    it.each([
      StorytimeTargetType.CHARACTER,
      StorytimeTargetType.COMMENT,
      StorytimeTargetType.SPOTLIGHT,
    ])('refuses to react to a %s', async targetType => {
      await expect(
        service.react(
          targetType,
          'target-1',
          StorytimeReaction.THUMBS_UP,
          readerId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('taking a reaction back', () => {
    it('deletes the row and recounts', async () => {
      await service.remove(StorytimeTargetType.STORY, storyId, readerId);

      expect(manager.delete).toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalled();
    });

    it('refuses a thing nobody may react to', async () => {
      await expect(
        service.remove(StorytimeTargetType.CHARACTER, 'target-1', readerId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reading how something stands', () => {
    it('counts the reactions and names the caller own', async () => {
      reactionRepository.find.mockResolvedValue([
        buildReaction(),
        buildReaction({ id: 'r2', userId: 'reader-2' }),
        buildReaction({
          id: 'r3',
          userId: 'reader-3',
          reaction: StorytimeReaction.THUMBS_DOWN,
        }),
      ]);

      const summary = await service.summarise(
        StorytimeTargetType.STORY,
        storyId,
        readerId,
      );

      expect(summary.upVotes).toBe(2);
      expect(summary.downVotes).toBe(1);
      expect(summary.rating).toBe(1);
      expect(summary.mine).toBe(StorytimeReaction.THUMBS_UP);
    });

    it('reports nothing of their own when they have not reacted', async () => {
      reactionRepository.find.mockResolvedValue([
        buildReaction({ userId: 'somebody-else' }),
      ]);

      const summary = await service.summarise(
        StorytimeTargetType.STORY,
        storyId,
        readerId,
      );

      expect(summary.mine).toBeNull();
    });

    // Nobody is signed in, so there is no reaction of their own to look for.
    it('answers for a signed-out reader', async () => {
      reactionRepository.find.mockResolvedValue([buildReaction()]);

      const summary = await service.summarise(
        StorytimeTargetType.STORY,
        storyId,
      );

      expect(summary.upVotes).toBe(1);
      expect(summary.mine).toBeNull();
    });

    // A listing of twenty Stories should not cost forty queries.
    it('summarises many things in one query', async () => {
      reactionRepository.find.mockResolvedValue([
        buildReaction(),
        buildReaction({ id: 'r2', targetId: 'story-2' }),
      ]);

      const summaries = await service.summariseMany(StorytimeTargetType.STORY, [
        storyId,
        'story-2',
        'story-3',
      ]);

      expect(reactionRepository.find).toHaveBeenCalledTimes(1);
      expect(summaries.map(summary => summary.targetId)).toEqual([
        storyId,
        'story-2',
        'story-3',
      ]);
      expect(summaries[2].upVotes).toBe(0);
    });

    it('asks for nothing when there is nothing to ask about', async () => {
      await expect(
        service.summariseMany(StorytimeTargetType.STORY, []),
      ).resolves.toEqual([]);
      expect(reactionRepository.find).not.toHaveBeenCalled();
    });
  });
});
