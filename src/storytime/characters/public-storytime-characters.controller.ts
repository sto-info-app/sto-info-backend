import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeChapterService } from '../chapters/storytime-chapter.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { CharacterAppearancesDto } from './dto/character-appearances.dto';
import { CharacterDto } from './dto/character.dto';
import { StorytimeAppearanceService } from './storytime-appearance.service';
import { StorytimeCharacterMapper } from './storytime-character.mapper';
import { StorytimeCharacterService } from './storytime-character.service';

/**
 * Reading a Story's cast, without needing an account.
 *
 * Characters are reached through their Story, so every route resolves the
 * Story first and refuses if it is not publicly readable. That single check is
 * what keeps the cast of a private Story unreachable — Characters have no
 * publication state of their own to check instead.
 */
@ApiTags('Storytime')
@Controller('storytime/stories/:storySlug/characters')
export class PublicStorytimeCharactersController {
  /**
   * Creates an instance of PublicStorytimeCharactersController.
   *
   * @param _characterService - The Character service.
   * @param _appearanceService - Records who appears in which Chapter.
   * @param _chapterService - Resolves the Chapters a Character appears in.
   * @param _storyService - Resolves and gates the owning Story.
   * @param _mapper - Maps Characters to their response shapes.
   * @param _featureService - Reports whether public reading is switched on.
   */
  constructor(
    private readonly _characterService: StorytimeCharacterService,
    private readonly _appearanceService: StorytimeAppearanceService,
    private readonly _chapterService: StorytimeChapterService,
    private readonly _storyService: StorytimeStoryService,
    private readonly _mapper: StorytimeCharacterMapper,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the cast of a published Story.
   *
   * @param storySlug - The Story slug.
   * @returns The cast, in display order.
   */
  @Get()
  @ApiOperation({ summary: 'List the cast of a published Story' })
  @ApiOkResponse({ type: [CharacterDto] })
  @ApiNotFoundResponse({ description: 'No readable Story matches the slug.' })
  async findAll(
    @Param('storySlug') storySlug: string,
  ): Promise<CharacterDto[]> {
    const story = await this.resolveReadableStory(storySlug);

    return this._mapper.toPublicList(
      await this._characterService.findPublicByStory(story.id),
    );
  }

  /**
   * Retrieves one Character, with the Chapters they appear in.
   *
   * Only Chapters a reader could open are listed. A Character whose only
   * appearances are in unpublished Chapters shows an empty list rather than
   * the titles of Chapters nobody can read yet.
   *
   * @param storySlug - The Story slug.
   * @param characterSlug - The Character slug.
   * @returns The Character and their appearances.
   */
  @Get(':characterSlug')
  @ApiOperation({ summary: 'Read a Character from a published Story' })
  @ApiOkResponse({ type: CharacterAppearancesDto })
  @ApiNotFoundResponse({ description: 'No readable Character matches.' })
  async findOne(
    @Param('storySlug') storySlug: string,
    @Param('characterSlug') characterSlug: string,
  ): Promise<CharacterAppearancesDto> {
    const story = await this.resolveReadableStory(storySlug);
    const character = await this._characterService.findPublicBySlug(
      story.id,
      characterSlug,
    );

    if (!character) {
      throw new NotFoundException('Character not found');
    }

    const appearances = await this._appearanceService.findByCharacter(
      character.id,
    );
    const readable = await this._chapterService.findPublicByStory(story.id);
    const readableById = new Map(
      readable.map(chapter => [chapter.id, chapter]),
    );

    return {
      character: this._mapper.toPublic(character),
      appearsIn: appearances.flatMap(appearance => {
        const chapter = readableById.get(appearance.chapterId);

        return chapter
          ? [
              {
                chapterId: chapter.id,
                chapterSlug: chapter.slug,
                chapterTitle: chapter.title,
                isPrimary: appearance.isPrimary,
              },
            ]
          : [];
      }),
    };
  }

  /**
   * Resolves a Story that the public may read, or fails.
   *
   * @param storySlug - The Story slug.
   * @returns The readable Story.
   * @throws NotFoundException when nothing readable matches.
   */
  private async resolveReadableStory(
    storySlug: string,
  ): Promise<StorytimeStoryEntity> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    const story = await this._storyService.findPublicBySlug(storySlug);

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    return story;
  }
}
