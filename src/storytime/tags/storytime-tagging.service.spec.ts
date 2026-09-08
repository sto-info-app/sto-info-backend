import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { StorytimeTagCategory } from '../enums/storytime-tag-category.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeArcTagEntity } from './entities/storytime-arc-tag.entity';
import { StorytimeCharacterTagEntity } from './entities/storytime-character-tag.entity';
import { StorytimeStoryTagEntity } from './entities/storytime-story-tag.entity';
import { StorytimeTagEntity } from './entities/storytime-tag.entity';
import { StorytimeTagService } from './storytime-tag.service';
import { StorytimeTaggingService } from './storytime-tagging.service';

describe('StorytimeTaggingService', () => {
  let service: StorytimeTaggingService;
  let storyTagRepository: {
    find: jest.Mock;
    delete: jest.Mock;
    insert: jest.Mock;
  };
  let arcTagRepository: {
    find: jest.Mock;
    delete: jest.Mock;
    insert: jest.Mock;
  };
  let characterTagRepository: {
    find: jest.Mock;
    delete: jest.Mock;
    insert: jest.Mock;
  };
  let tagService: { findByIds: jest.Mock };

  const storyId = 'story-1';

  /**
   * Builds a tag.
   *
   * @param overrides - Fields to change.
   * @returns The tag.
   */
  const buildTag = (
    overrides: Partial<StorytimeTagEntity> = {},
  ): StorytimeTagEntity =>
    Object.assign(new StorytimeTagEntity(), {
      id: 'tag-1',
      slug: 'klingon',
      name: 'Klingon',
      category: StorytimeTagCategory.FACTION,
      displayOrder: 0,
      ...overrides,
    });

  /**
   * Builds a join-table repository stub.
   *
   * @param rows - The rows it should return.
   * @returns The stub.
   */
  const buildJoinRepository = (rows: unknown[] = []) => ({
    find: jest.fn().mockResolvedValue(rows),
    delete: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
  });

  beforeEach(async () => {
    storyTagRepository = buildJoinRepository();
    arcTagRepository = buildJoinRepository();
    characterTagRepository = buildJoinRepository();
    tagService = { findByIds: jest.fn().mockResolvedValue([buildTag()]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeTaggingService,
        {
          provide: getRepositoryToken(StorytimeStoryTagEntity),
          useValue: storyTagRepository,
        },
        {
          provide: getRepositoryToken(StorytimeArcTagEntity),
          useValue: arcTagRepository,
        },
        {
          provide: getRepositoryToken(StorytimeCharacterTagEntity),
          useValue: characterTagRepository,
        },
        { provide: StorytimeTagService, useValue: tagService },
      ],
    }).compile();

    service = module.get<StorytimeTaggingService>(StorytimeTaggingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('reading tags', () => {
    it('reads the tags on a Story', async () => {
      storyTagRepository.find.mockResolvedValue([{ tagId: 'tag-1' }]);

      const tags = await service.findFor(StorytimeTargetType.STORY, storyId);

      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe('Klingon');
    });

    it.each([
      ['an Arc', StorytimeTargetType.ARC, () => arcTagRepository],
      [
        'a Character',
        StorytimeTargetType.CHARACTER,
        () => characterTagRepository,
      ],
    ])('reads the tags on %s', async (_name, targetType, repository) => {
      await service.findFor(targetType, 'target-1');

      expect(repository().find).toHaveBeenCalled();
    });

    // Tags come back the way the vocabulary is arranged, not the order the
    // join rows happen to be in.
    it('sorts tags by category, then order, then name', async () => {
      storyTagRepository.find.mockResolvedValue([
        { tagId: 'tag-1' },
        { tagId: 'tag-2' },
        { tagId: 'tag-3' },
      ]);
      tagService.findByIds.mockResolvedValue([
        buildTag({
          id: 'tag-3',
          name: 'Zeta',
          category: StorytimeTagCategory.GENRE,
        }),
        buildTag({
          id: 'tag-2',
          name: 'Alpha',
          category: StorytimeTagCategory.GENRE,
        }),
        buildTag({ id: 'tag-1', name: 'Klingon' }),
      ]);

      const tags = await service.findFor(StorytimeTargetType.STORY, storyId);

      expect(tags.map(tag => tag.name)).toEqual(['Klingon', 'Alpha', 'Zeta']);
    });

    it('sorts by the order within a category before the name', async () => {
      storyTagRepository.find.mockResolvedValue([
        { tagId: 'tag-1' },
        { tagId: 'tag-2' },
      ]);
      tagService.findByIds.mockResolvedValue([
        buildTag({ id: 'tag-1', name: 'Andorian', displayOrder: 2 }),
        buildTag({ id: 'tag-2', name: 'Klingon', displayOrder: 1 }),
      ]);

      const tags = await service.findFor(StorytimeTargetType.STORY, storyId);

      expect(tags.map(tag => tag.name)).toEqual(['Klingon', 'Andorian']);
    });
  });

  describe('reading tags for a listing', () => {
    // A listing of twenty Stories should not cost forty round trips.
    it('reads many at once, keyed by what they belong to', async () => {
      storyTagRepository.find.mockResolvedValue([
        { storyId: 'story-1', tagId: 'tag-1' },
        { storyId: 'story-2', tagId: 'tag-1' },
      ]);

      const byStory = await service.findForMany(StorytimeTargetType.STORY, [
        'story-1',
        'story-2',
      ]);

      expect(storyTagRepository.find).toHaveBeenCalledTimes(1);
      expect(tagService.findByIds).toHaveBeenCalledTimes(1);
      expect(byStory.get('story-1')?.[0].name).toBe('Klingon');
      expect(byStory.get('story-2')).toHaveLength(1);
    });

    it('asks for nothing when there is nothing to ask about', async () => {
      const byStory = await service.findForMany(StorytimeTargetType.STORY, []);

      expect(byStory.size).toBe(0);
      expect(storyTagRepository.find).not.toHaveBeenCalled();
    });

    // A tag deleted between the two queries would otherwise appear as a hole.
    it('leaves out a join row whose tag has gone', async () => {
      storyTagRepository.find.mockResolvedValue([
        { storyId: 'story-1', tagId: 'tag-gone' },
      ]);
      tagService.findByIds.mockResolvedValue([]);

      const byStory = await service.findForMany(StorytimeTargetType.STORY, [
        'story-1',
      ]);

      expect(byStory.get('story-1')).toBeUndefined();
    });
  });

  describe('setting tags', () => {
    it('replaces whatever was there', async () => {
      await service.setTags(StorytimeTargetType.STORY, storyId, ['tag-1']);

      expect(storyTagRepository.delete).toHaveBeenCalledWith({ storyId });
      expect(storyTagRepository.insert).toHaveBeenCalledWith([
        { storyId, tagId: 'tag-1' },
      ]);
    });

    it('clears the tags when given none', async () => {
      tagService.findByIds.mockResolvedValue([]);

      await service.setTags(StorytimeTargetType.STORY, storyId, []);

      expect(storyTagRepository.delete).toHaveBeenCalled();
      expect(storyTagRepository.insert).not.toHaveBeenCalled();
    });

    it('ignores a tag sent twice', async () => {
      await service.setTags(StorytimeTargetType.STORY, storyId, [
        'tag-1',
        'tag-1',
      ]);

      expect(storyTagRepository.insert).toHaveBeenCalledWith([
        { storyId, tagId: 'tag-1' },
      ]);
    });

    // Silently dropping it would leave the creator believing they had tagged
    // something they had not.
    it('refuses when one of the tags no longer exists', async () => {
      tagService.findByIds.mockResolvedValue([]);

      await expect(
        service.setTags(StorytimeTargetType.STORY, storyId, ['tag-gone']),
      ).rejects.toThrow(/no longer exists/);
    });

    it('tags an Arc', async () => {
      await service.setTags(StorytimeTargetType.ARC, 'arc-1', ['tag-1']);

      expect(arcTagRepository.insert).toHaveBeenCalledWith([
        { arcId: 'arc-1', tagId: 'tag-1' },
      ]);
    });

    it('tags a Character', async () => {
      await service.setTags(StorytimeTargetType.CHARACTER, 'character-1', [
        'tag-1',
      ]);

      expect(characterTagRepository.insert).toHaveBeenCalledWith([
        { characterId: 'character-1', tagId: 'tag-1' },
      ]);
    });

    // A Chapter is classified by its Story, so there is no join table for one.
    it('refuses a kind that cannot be tagged', async () => {
      await expect(
        service.setTags(StorytimeTargetType.CHAPTER, 'chapter-1', ['tag-1']),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('finding what carries a tag', () => {
    it('lists the Stories with a tag', async () => {
      storyTagRepository.find.mockResolvedValue([
        { storyId: 'story-1', tagId: 'tag-1' },
        { storyId: 'story-2', tagId: 'tag-1' },
      ]);

      const found = await service.findTargetsWithTag(
        StorytimeTargetType.STORY,
        'tag-1',
      );

      expect(found).toEqual(['story-1', 'story-2']);
    });

    it('lists the Arcs with a tag', async () => {
      arcTagRepository.find.mockResolvedValue([
        { arcId: 'arc-1', tagId: 'tag-1' },
      ]);

      await expect(
        service.findTargetsWithTag(StorytimeTargetType.ARC, 'tag-1'),
      ).resolves.toEqual(['arc-1']);
    });
  });
});
