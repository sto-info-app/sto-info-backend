import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { SetAppearancesDto } from './dto/set-appearances.dto';
import { StorytimeChapterCharacterEntity } from './entities/storytime-chapter-character.entity';
import { StorytimeCharacterEntity } from './entities/storytime-character.entity';

/**
 * Who appears in which Chapter.
 *
 * The one rule this service exists to keep is that a Chapter and a Character
 * must belong to the same Story. It is not enforced by the schema — that would
 * need a redundant `storyId` on the join table plus composite foreign keys, a
 * column that could itself come to disagree with the two it duplicates — so it
 * is enforced here, on every path that can create an appearance.
 */
@Injectable()
export class StorytimeAppearanceService {
  private readonly _logger = new Logger(StorytimeAppearanceService.name);

  /**
   * Creates an instance of StorytimeAppearanceService.
   *
   * @param _appearanceRepository - Repository of appearances.
   * @param _chapterRepository - Repository of Chapters, to check the Story.
   * @param _characterRepository - Repository of Characters, to check the Story.
   * @param _storyService - Decides who may act on the owning Story.
   * @param _orderingService - Calculates positions within a Chapter's cast.
   */
  constructor(
    @InjectRepository(StorytimeChapterCharacterEntity)
    private readonly _appearanceRepository: Repository<StorytimeChapterCharacterEntity>,
    @InjectRepository(StorytimeChapterEntity)
    private readonly _chapterRepository: Repository<StorytimeChapterEntity>,
    @InjectRepository(StorytimeCharacterEntity)
    private readonly _characterRepository: Repository<StorytimeCharacterEntity>,
    private readonly _storyService: StorytimeStoryService,
    private readonly _orderingService: StorytimeOrderingService,
  ) {}

  /**
   * Replaces the whole cast of a Chapter.
   *
   * Sent as a whole list rather than added and removed one at a time, because
   * the editor shows the cast as a set of ticks: what the creator means by
   * saving is "these, and only these".
   *
   * @param chapterId - The Chapter.
   * @param dto - The Characters appearing, in order.
   * @param actingUserId - The caller.
   * @returns The appearances as saved.
   * @throws BadRequestException when a Character belongs to another Story.
   */
  async setAppearances(
    chapterId: string,
    dto: SetAppearancesDto,
    actingUserId: string,
  ): Promise<StorytimeChapterCharacterEntity[]> {
    const chapter = await this.findChapterOrFail(chapterId);

    await this._storyService.findEditableOrFail(
      chapter.storyId,
      actingUserId,
      StoryCapability.MANAGE_CHARACTERS,
    );
    await this.assertSameStory(chapter.storyId, dto.appearances);

    // Replaced wholesale rather than diffed: the alternative is three passes
    // over the same list to work out what changed, for a table that holds a
    // handful of rows per Chapter.
    await this._appearanceRepository.delete({ chapterId });

    if (dto.appearances.length === 0) {
      return [];
    }

    const positions = this._orderingService.renumber(
      dto.appearances.map(appearance => appearance.characterId),
    );

    const appearances = dto.appearances.map((appearance, position) =>
      this._appearanceRepository.create({
        chapterId,
        characterId: appearance.characterId,
        appearanceOrder: positions[position].orderIndex,
        appearanceNotes: appearance.appearanceNotes ?? null,
        isPrimary: appearance.isPrimary ?? false,
        createdByUserId: actingUserId,
      }),
    );

    const saved = await this._appearanceRepository.save(appearances);

    this._logger.log(
      `Chapter ${chapterId} cast set to ${saved.length} Character(s) by ${actingUserId}`,
    );

    return saved;
  }

  /**
   * Lists who appears in a Chapter.
   *
   * Takes no view on whether the caller may see it. Callers reaching this for
   * a reader hold the readable Chapter already; callers reaching it for a
   * creator must use {@link findByChapterForOwner}.
   *
   * @param chapterId - The Chapter.
   * @returns The appearances, in order.
   */
  findByChapter(chapterId: string): Promise<StorytimeChapterCharacterEntity[]> {
    return this._appearanceRepository.find({
      where: { chapterId },
      order: { appearanceOrder: 'ASC' },
    });
  }

  /**
   * Lists who appears in a Chapter the caller owns.
   *
   * A draft Chapter's cast is not public, so the owning Story is checked here
   * rather than left to the permission on the route: holding the permission to
   * edit your own Stories says nothing about whose Chapter this is.
   *
   * @param chapterId - The Chapter.
   * @param actingUserId - The caller.
   * @returns The appearances, in order.
   * @throws BadRequestException when the Chapter does not exist.
   */
  async findByChapterForOwner(
    chapterId: string,
    actingUserId: string,
  ): Promise<StorytimeChapterCharacterEntity[]> {
    const chapter = await this.findChapterOrFail(chapterId);

    await this._storyService.findEditableOrFail(
      chapter.storyId,
      actingUserId,
      StoryCapability.MANAGE_CHARACTERS,
    );

    return this.findByChapter(chapterId);
  }

  /**
   * Lists the Chapters a Character appears in.
   *
   * @param characterId - The Character.
   * @returns The appearances, in order.
   */
  findByCharacter(
    characterId: string,
  ): Promise<StorytimeChapterCharacterEntity[]> {
    return this._appearanceRepository.find({
      where: { characterId },
      order: { appearanceOrder: 'ASC' },
    });
  }

  /**
   * Lists the appearances across several Chapters at once.
   *
   * Used by the Chapter list, so showing a cast beside every Chapter is one
   * query rather than one per Chapter.
   *
   * @param chapterIds - The Chapters.
   * @returns The appearances across them all.
   */
  findByChapters(
    chapterIds: string[],
  ): Promise<StorytimeChapterCharacterEntity[]> {
    if (chapterIds.length === 0) {
      return Promise.resolve([]);
    }

    return this._appearanceRepository.find({
      where: { chapterId: In(chapterIds) },
      order: { appearanceOrder: 'ASC' },
    });
  }

  /**
   * Loads a Chapter, or fails.
   *
   * @param chapterId - The Chapter.
   * @returns The Chapter.
   * @throws BadRequestException when it does not exist.
   */
  private async findChapterOrFail(
    chapterId: string,
  ): Promise<StorytimeChapterEntity> {
    const chapter = await this._chapterRepository.findOne({
      where: { id: chapterId },
    });

    if (!chapter) {
      throw new BadRequestException('Chapter not found');
    }

    return chapter;
  }

  /**
   * Requires that every named Character belongs to the Chapter's Story.
   *
   * A Character from another Story appearing in this one would put somebody
   * else's cast member in a Story their owner cannot edit, and would show a
   * creator a name they have no way to change or remove.
   *
   * @param storyId - The Story the Chapter belongs to.
   * @param appearances - The submitted appearances.
   * @throws BadRequestException naming the problem.
   */
  private async assertSameStory(
    storyId: string,
    appearances: SetAppearancesDto['appearances'],
  ): Promise<void> {
    if (appearances.length === 0) {
      return;
    }

    const characterIds = appearances.map(appearance => appearance.characterId);

    if (new Set(characterIds).size !== characterIds.length) {
      throw new BadRequestException(
        'A Character may only appear once in a Chapter.',
      );
    }

    const characters = await this._characterRepository.find({
      where: { id: In(characterIds) },
    });

    const usable = new Set(
      characters
        .filter(character => character.storyId === storyId)
        .map(character => character.id),
    );

    // Checked by membership rather than by count: a Character that does not
    // exist and one belonging to another Story must both be refused, and
    // counting alone would let the two cancel out.
    if (!characterIds.every(id => usable.has(id))) {
      throw new BadRequestException(
        'Every Character must belong to the same Story as the Chapter.',
      );
    }
  }
}
