import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeModerationTargetService } from './storytime-moderation-target.service';

describe('StorytimeModerationTargetService', () => {
  let service: StorytimeModerationTargetService;
  let storyRepository: { findOne: jest.Mock; save: jest.Mock };
  let chapterRepository: { findOne: jest.Mock; save: jest.Mock };
  let characterRepository: { findOne: jest.Mock; save: jest.Mock };
  let arcRepository: { findOne: jest.Mock; save: jest.Mock };

  const story = Object.assign(new StorytimeStoryEntity(), {
    id: 'story-1',
    ownerUserId: 'writer-1',
    title: 'A Fine Story',
  });

  beforeEach(async () => {
    storyRepository = {
      findOne: jest.fn().mockResolvedValue(story),
      save: jest.fn(input => Promise.resolve(input)),
    };
    chapterRepository = {
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeChapterEntity(), {
          id: 'chapter-1',
          storyId: 'story-1',
          title: 'First Contact',
        }),
      ),
      save: jest.fn(input => Promise.resolve(input)),
    };
    characterRepository = {
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeCharacterEntity(), {
          id: 'character-1',
          storyId: 'story-1',
          name: 'T’Vel',
        }),
      ),
      save: jest.fn(input => Promise.resolve(input)),
    };
    arcRepository = {
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeArcEntity(), {
          id: 'arc-1',
          ownerUserId: 'curator-1',
          title: 'The Long War',
        }),
      ),
      save: jest.fn(input => Promise.resolve(input)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeModerationTargetService,
        {
          provide: getRepositoryToken(StorytimeStoryEntity),
          useValue: storyRepository,
        },
        {
          provide: getRepositoryToken(StorytimeChapterEntity),
          useValue: chapterRepository,
        },
        {
          provide: getRepositoryToken(StorytimeCharacterEntity),
          useValue: characterRepository,
        },
        {
          provide: getRepositoryToken(StorytimeArcEntity),
          useValue: arcRepository,
        },
      ],
    }).compile();

    service = module.get<StorytimeModerationTargetService>(
      StorytimeModerationTargetService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it.each([
    [StorytimeTargetType.STORY, true],
    [StorytimeTargetType.CHAPTER, true],
    [StorytimeTargetType.CHARACTER, true],
    [StorytimeTargetType.ARC, true],
    [StorytimeTargetType.MEDIA, false],
    [StorytimeTargetType.CREW_CREDIT, false],
    [StorytimeTargetType.COMMENT, false],
    [StorytimeTargetType.SPOTLIGHT, false],
  ])('knows whether a %s can be removed on its own', (targetType, expected) => {
    expect(service.isModeratable(targetType)).toBe(expected);
  });

  it('finds a Story, with its owner and title', async () => {
    const target = await service.find(StorytimeTargetType.STORY, 'story-1');

    expect(target?.ownerUserId).toBe('writer-1');
    expect(target?.label).toBe('A Fine Story');
  });

  it('finds an Arc, with its curator and title', async () => {
    const target = await service.find(StorytimeTargetType.ARC, 'arc-1');

    expect(target?.ownerUserId).toBe('curator-1');
    expect(target?.label).toBe('The Long War');
  });

  // A Chapter has nobody of its own to tell, so the Story's owner is who has
  // to hear about it.
  it('answers for a Chapter with its Story’s owner', async () => {
    const target = await service.find(StorytimeTargetType.CHAPTER, 'chapter-1');

    expect(target?.ownerUserId).toBe('writer-1');
    expect(target?.label).toBe('First Contact');
  });

  it('answers for a Character with its Story’s owner, named as a Character', async () => {
    const target = await service.find(
      StorytimeTargetType.CHARACTER,
      'character-1',
    );

    expect(target?.ownerUserId).toBe('writer-1');
    expect(target?.label).toBe('T’Vel');
  });

  it.each([
    ['Story', StorytimeTargetType.STORY, () => storyRepository],
    ['Chapter', StorytimeTargetType.CHAPTER, () => chapterRepository],
    ['Character', StorytimeTargetType.CHARACTER, () => characterRepository],
    ['Arc', StorytimeTargetType.ARC, () => arcRepository],
  ])(
    'reports a %s that is not there',
    async (_name, targetType, repository) => {
      repository().findOne.mockResolvedValue(null);

      await expect(service.find(targetType, 'missing')).resolves.toBeNull();
    },
  );

  // A Chapter whose Story has gone has nobody to answer for it.
  it('reports a Chapter whose Story has gone', async () => {
    storyRepository.findOne.mockResolvedValue(null);

    await expect(
      service.find(StorytimeTargetType.CHAPTER, 'chapter-1'),
    ).resolves.toBeNull();
  });

  it('refuses a kind that cannot be removed on its own', async () => {
    await expect(
      service.find(StorytimeTargetType.COMMENT, 'comment-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it.each([
    ['Story', StorytimeTargetType.STORY, () => storyRepository],
    ['Chapter', StorytimeTargetType.CHAPTER, () => chapterRepository],
    ['Character', StorytimeTargetType.CHARACTER, () => characterRepository],
    ['Arc', StorytimeTargetType.ARC, () => arcRepository],
  ])(
    'saves a %s back to its own table',
    async (_name, targetType, repository) => {
      await service.save(targetType, story);

      expect(repository().save).toHaveBeenCalled();
    },
  );

  it.each([
    [StorytimeTargetType.STORY, 'Story'],
    [StorytimeTargetType.CHAPTER, 'Chapter'],
    [StorytimeTargetType.CHARACTER, 'Character'],
    [StorytimeTargetType.ARC, 'Arc'],
    [StorytimeTargetType.MEDIA, 'Media'],
    [StorytimeTargetType.CREW_CREDIT, 'Crew credit'],
    [StorytimeTargetType.COMMENT, 'Comment'],
    [StorytimeTargetType.SPOTLIGHT, 'Spotlight entry'],
  ])('describes a %s as "%s"', (targetType, expected) => {
    expect(service.describe(targetType)).toBe(expected);
  });
});
