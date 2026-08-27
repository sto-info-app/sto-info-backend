import {
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeChapterCharacterEntity } from './entities/storytime-chapter-character.entity';
import { StorytimeCharacterEntity } from './entities/storytime-character.entity';
import { StorytimeAppearanceService } from './storytime-appearance.service';

describe('StorytimeAppearanceService', () => {
  let service: StorytimeAppearanceService;
  let appearanceRepository: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let chapterRepository: { findOne: jest.Mock };
  let characterRepository: { find: jest.Mock };
  let storyService: { findEditableOrFail: jest.Mock };

  const ownerId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const storyId = 'e6d3a1b2-0000-4000-8000-0000000000aa';
  const otherStoryId = 'e6d3a1b2-0000-4000-8000-0000000000ab';
  const chapterId = 'e6d3a1b2-0000-4000-8000-0000000000bb';

  /**
   * Builds a Character belonging to a Story.
   *
   * @param id - The Character identifier.
   * @param owningStoryId - The Story it belongs to.
   * @returns The Character entity.
   */
  const buildCharacter = (id: string, owningStoryId = storyId) =>
    Object.assign(new StorytimeCharacterEntity(), {
      id,
      storyId: owningStoryId,
    });

  beforeEach(async () => {
    appearanceRepository = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn(input =>
        Object.assign(new StorytimeChapterCharacterEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    chapterRepository = {
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeChapterEntity(), {
          id: chapterId,
          storyId,
        }),
      ),
    };
    characterRepository = {
      find: jest
        .fn()
        .mockResolvedValue([
          buildCharacter('char-1'),
          buildCharacter('char-2'),
        ]),
    };
    storyService = {
      findEditableOrFail: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeStoryEntity(), {
          id: storyId,
          ownerUserId: ownerId,
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeAppearanceService,
        {
          provide: getRepositoryToken(StorytimeChapterCharacterEntity),
          useValue: appearanceRepository,
        },
        {
          provide: getRepositoryToken(StorytimeChapterEntity),
          useValue: chapterRepository,
        },
        {
          provide: getRepositoryToken(StorytimeCharacterEntity),
          useValue: characterRepository,
        },
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeOrderingService,
      ],
    }).compile();

    service = module.get<StorytimeAppearanceService>(
      StorytimeAppearanceService,
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

  describe('setting a Chapter’s cast', () => {
    it('records who appears', async () => {
      const saved = await service.setAppearances(
        chapterId,
        { appearances: [{ characterId: 'char-1' }] },
        ownerId,
      );

      expect(saved).toHaveLength(1);
      expect(saved[0].characterId).toBe('char-1');
      expect(saved[0].createdByUserId).toBe(ownerId);
    });

    it('keeps the order the creator sent', async () => {
      await service.setAppearances(
        chapterId,
        { appearances: [{ characterId: 'char-2' }, { characterId: 'char-1' }] },
        ownerId,
      );

      const saved = appearanceRepository.save.mock
        .calls[0][0] as StorytimeChapterCharacterEntity[];
      expect(saved[0].characterId).toBe('char-2');
      expect(saved[0].appearanceOrder).toBeLessThan(saved[1].appearanceOrder);
    });

    it('records the notes and whether they are central', async () => {
      const saved = await service.setAppearances(
        chapterId,
        {
          appearances: [
            {
              characterId: 'char-1',
              appearanceNotes: 'Takes the bridge.',
              isPrimary: true,
            },
          ],
        },
        ownerId,
      );

      expect(saved[0].appearanceNotes).toBe('Takes the bridge.');
      expect(saved[0].isPrimary).toBe(true);
    });

    it('defaults the notes and primacy when they are not sent', async () => {
      const saved = await service.setAppearances(
        chapterId,
        { appearances: [{ characterId: 'char-1' }] },
        ownerId,
      );

      expect(saved[0].appearanceNotes).toBeNull();
      expect(saved[0].isPrimary).toBe(false);
    });

    // The editor shows the cast as a set of ticks, so what a creator means by
    // saving is "these, and only these".
    it('replaces the previous cast rather than adding to it', async () => {
      await service.setAppearances(
        chapterId,
        { appearances: [{ characterId: 'char-1' }] },
        ownerId,
      );

      expect(appearanceRepository.delete).toHaveBeenCalledWith({ chapterId });
    });

    it('clears the cast when sent an empty list', async () => {
      const saved = await service.setAppearances(
        chapterId,
        { appearances: [] },
        ownerId,
      );

      expect(appearanceRepository.delete).toHaveBeenCalledWith({ chapterId });
      expect(saved).toEqual([]);
      expect(appearanceRepository.save).not.toHaveBeenCalled();
    });

    it('refuses when the caller does not own the Story', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.setAppearances(
          chapterId,
          { appearances: [{ characterId: 'char-1' }] },
          ownerId,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses an unknown Chapter', async () => {
      chapterRepository.findOne.mockResolvedValue(null);

      await expect(
        service.setAppearances(chapterId, { appearances: [] }, ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    // The rule the schema does not enforce, so this is where it has to hold.
    describe('the same-Story rule', () => {
      it('refuses a Character from another Story', async () => {
        characterRepository.find.mockResolvedValue([
          buildCharacter('char-1'),
          buildCharacter('char-9', otherStoryId),
        ]);

        await expect(
          service.setAppearances(
            chapterId,
            {
              appearances: [
                { characterId: 'char-1' },
                { characterId: 'char-9' },
              ],
            },
            ownerId,
          ),
        ).rejects.toThrow(/same Story/);
      });

      it('refuses a Character that does not exist', async () => {
        characterRepository.find.mockResolvedValue([]);

        await expect(
          service.setAppearances(
            chapterId,
            { appearances: [{ characterId: 'char-nope' }] },
            ownerId,
          ),
        ).rejects.toThrow(/same Story/);
      });

      it('saves nothing when a Character is rejected', async () => {
        characterRepository.find.mockResolvedValue([]);

        await expect(
          service.setAppearances(
            chapterId,
            { appearances: [{ characterId: 'char-nope' }] },
            ownerId,
          ),
        ).rejects.toThrow(BadRequestException);

        expect(appearanceRepository.delete).not.toHaveBeenCalled();
        expect(appearanceRepository.save).not.toHaveBeenCalled();
      });

      // The pair is the key, so the database would reject this anyway — but
      // with a constraint violation rather than something a creator can read.
      it('refuses the same Character twice', async () => {
        await expect(
          service.setAppearances(
            chapterId,
            {
              appearances: [
                { characterId: 'char-1' },
                { characterId: 'char-1' },
              ],
            },
            ownerId,
          ),
        ).rejects.toThrow(/only appear once/);
      });

      it('asks for no Characters when the cast is emptied', async () => {
        await service.setAppearances(chapterId, { appearances: [] }, ownerId);

        expect(characterRepository.find).not.toHaveBeenCalled();
      });
    });
  });

  describe('reading appearances', () => {
    it('lists who appears in a Chapter, in order', async () => {
      await service.findByChapter(chapterId);

      expect(appearanceRepository.find).toHaveBeenCalledWith({
        where: { chapterId },
        order: { appearanceOrder: 'ASC' },
      });
    });

    it('lists the Chapters a Character appears in', async () => {
      await service.findByCharacter('char-1');

      expect(appearanceRepository.find).toHaveBeenCalledWith({
        where: { characterId: 'char-1' },
        order: { appearanceOrder: 'ASC' },
      });
    });

    // Showing a cast beside every Chapter should be one query, not one per
    // Chapter.
    it('lists appearances across several Chapters at once', async () => {
      await service.findByChapters(['chapter-1', 'chapter-2']);

      expect(appearanceRepository.find).toHaveBeenCalledTimes(1);
    });

    it('asks for nothing when given no Chapters', async () => {
      await expect(service.findByChapters([])).resolves.toEqual([]);
      expect(appearanceRepository.find).not.toHaveBeenCalled();
    });

    // A draft Chapter's cast is not public, and holding the permission to edit
    // your own Stories says nothing about whose Chapter this is.
    describe('for a creator', () => {
      it('lists the cast of a Chapter they own', async () => {
        await service.findByChapterForOwner(chapterId, ownerId);

        expect(storyService.findEditableOrFail).toHaveBeenCalledWith(
          storyId,
          ownerId,
          StoryCapability.MANAGE_CHARACTERS,
        );
        expect(appearanceRepository.find).toHaveBeenCalled();
      });

      it('refuses a Chapter belonging to somebody else', async () => {
        storyService.findEditableOrFail.mockRejectedValue(
          new ForbiddenException(),
        );

        await expect(
          service.findByChapterForOwner(chapterId, ownerId),
        ).rejects.toThrow(ForbiddenException);
        expect(appearanceRepository.find).not.toHaveBeenCalled();
      });

      it('refuses an unknown Chapter', async () => {
        chapterRepository.findOne.mockResolvedValue(null);

        await expect(
          service.findByChapterForOwner(chapterId, ownerId),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });
});
