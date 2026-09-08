import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, IsNull, Not, Repository } from 'typeorm';

import { LimitService } from '../../access-control/limit.service';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { STORYTIME_LIMITS } from '../constants/storytime-limits.constants';
import { StorytimeMarkdownService } from '../content/storytime-markdown.service';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { assertImageDescribable } from '../images/storytime-image-alt.utility';
import { StorytimeImageService } from '../images/storytime-image.service';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import { StorytimeSlugService } from '../shared/storytime-slug.service';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { CreateStorytimeCharacterDto } from './dto/create-storytime-character.dto';
import { UpdateStorytimeCharacterDto } from './dto/update-storytime-character.dto';
import { StorytimeCharacterEntity } from './entities/storytime-character.entity';

/**
 * Creating, editing and ordering the cast of a Story.
 *
 * Access is decided by the Story, exactly as it is for Chapters: a caller may
 * act on a Character when they may act on the Story that owns it. That check is
 * delegated rather than duplicated, so the two can never disagree about who
 * owns what.
 *
 * Characters have no publication state. One is visible exactly when its Story
 * is, because a cast list that could be published separately from the Story it
 * belongs to would only ever be half a cast list.
 */
@Injectable()
export class StorytimeCharacterService {
  private readonly _logger = new Logger(StorytimeCharacterService.name);

  /**
   * Creates an instance of StorytimeCharacterService.
   *
   * @param _characterRepository - Repository of Characters.
   * @param _storyService - Decides who may act on the owning Story.
   * @param _slugService - Produces slugs and remembers retired ones.
   * @param _orderingService - Calculates positions within the cast list.
   * @param _markdownService - Renders Character biographies.
   * @param _limitService - Resolves how many Characters a Story may hold.
   * @param _imageService - Checks, stores and releases Character portraits.
   */
  constructor(
    @InjectRepository(StorytimeCharacterEntity)
    private readonly _characterRepository: Repository<StorytimeCharacterEntity>,
    private readonly _storyService: StorytimeStoryService,
    private readonly _slugService: StorytimeSlugService,
    private readonly _orderingService: StorytimeOrderingService,
    private readonly _markdownService: StorytimeMarkdownService,
    private readonly _limitService: LimitService,
    private readonly _imageService: StorytimeImageService,
  ) {}

  /**
   * Creates a Character in a Story the caller owns.
   *
   * @param storyId - The Story to add to.
   * @param dto - The Character to create.
   * @param actingUserId - The caller.
   * @returns The created Character.
   */
  async create(
    storyId: string,
    dto: CreateStorytimeCharacterDto,
    actingUserId: string,
  ): Promise<StorytimeCharacterEntity> {
    await this._storyService.findEditableOrFail(
      storyId,
      actingUserId,
      StoryCapability.MANAGE_CHARACTERS,
    );
    await this.assertWithinCharacterLimit(storyId, actingUserId);

    const slug = await this._slugService.generateUniqueSlug({
      desiredSlug: dto.slug,
      title: dto.name,
      targetType: StorytimeTargetType.CHARACTER,
      storyId,
      isTakenByLiveEntity: candidate => this.isSlugTaken(storyId, candidate),
    });

    const rendered = this._markdownService.render(dto.biographySource ?? '');

    const character = this._characterRepository.create({
      ...dto,
      storyId,
      slug,
      biographySource: dto.biographySource ?? '',
      biographyHtml: rendered.html,
      biographySchemaVersion: rendered.schemaVersion,
      traits: this.normaliseTraits(dto.traits),
      displayOrder: await this.nextDisplayOrder(storyId),
      createdByUserId: actingUserId,
      updatedByUserId: actingUserId,
    });

    const saved = await this._characterRepository.save(character);

    this._logger.log(
      `Character '${saved.slug}' created in Story ${storyId} by ${actingUserId}`,
    );

    return saved;
  }

  /**
   * Updates a Character.
   *
   * @param characterId - The Character to update.
   * @param dto - The changes, including the version last seen.
   * @param actingUserId - The caller.
   * @returns The updated Character.
   * @throws ConflictException when the Character changed since it was loaded.
   */
  async update(
    characterId: string,
    dto: UpdateStorytimeCharacterDto,
    actingUserId: string,
  ): Promise<StorytimeCharacterEntity> {
    const character = await this.findEditableOrFail(characterId, actingUserId);

    if (dto.version !== undefined && dto.version !== character.version) {
      throw new ConflictException(
        'This Character has changed since you opened it. Reload and try again.',
      );
    }

    assertImageDescribable(
      character.portraitImageId,
      dto.portraitImageAlt,
      'portrait',
    );

    if (dto.name !== undefined) {
      character.name = dto.name;
    }

    await this.applySlugChange(character, dto);
    this.applyBiography(character, dto);
    this.applyProfileFields(character, dto);

    character.updatedByUserId = actingUserId;
    character.version += 1;

    return this._characterRepository.save(character);
  }

  /**
   * Lists every Character of a Story the caller owns.
   *
   * @param storyId - The Story.
   * @param actingUserId - The caller.
   * @returns The cast, in display order.
   */
  async findManagedByStory(
    storyId: string,
    actingUserId: string,
  ): Promise<StorytimeCharacterEntity[]> {
    await this._storyService.findEditableOrFail(
      storyId,
      actingUserId,
      StoryCapability.MANAGE_CHARACTERS,
    );

    return this._characterRepository.find({
      where: { storyId },
      order: { displayOrder: 'ASC', name: 'ASC' },
    });
  }

  /**
   * Retrieves a Character the caller may edit.
   *
   * @param characterId - The Character.
   * @param actingUserId - The caller.
   * @returns The Character.
   * @throws NotFoundException when it does not exist.
   */
  async findEditableOrFail(
    characterId: string,
    actingUserId: string,
  ): Promise<StorytimeCharacterEntity> {
    const character = await this._characterRepository.findOne({
      where: { id: characterId },
    });

    if (!character) {
      throw new NotFoundException('Character not found');
    }

    await this._storyService.findEditableOrFail(
      character.storyId,
      actingUserId,
      StoryCapability.MANAGE_CHARACTERS,
    );

    return character;
  }

  /**
   * Lists the publicly visible cast of a Story.
   *
   * Whether the Story itself is readable is the caller's question to ask; this
   * only excludes Characters an administrator has removed.
   *
   * @param storyId - The Story.
   * @returns The cast, in display order.
   */
  findPublicByStory(storyId: string): Promise<StorytimeCharacterEntity[]> {
    return this._characterRepository.find({
      where: {
        storyId,
        moderationStatus: StorytimeModerationStatus.ACTIVE,
      },
      order: { displayOrder: 'ASC', name: 'ASC' },
    });
  }

  /**
   * Finds one publicly visible Character of a Story by slug.
   *
   * @param storyId - The Story.
   * @param slug - The Character slug.
   * @returns The Character, or null when nothing visible matches.
   */
  async findPublicBySlug(
    storyId: string,
    slug: string,
  ): Promise<StorytimeCharacterEntity | null> {
    const character = await this._characterRepository.findOne({
      where: { storyId, slug },
    });

    // A reader who followed a link to a Character that has since been taken
    // down is told so, rather than that it never existed. A Character has no
    // publication state of its own — its Story's readability is the gate, and
    // the caller has already passed it to get here.
    if (
      character &&
      character.moderationStatus === StorytimeModerationStatus.REMOVED
    ) {
      throw new GoneException(
        'This Character has been removed by an administrator.',
      );
    }

    if (
      !character ||
      character.moderationStatus !== StorytimeModerationStatus.ACTIVE
    ) {
      return null;
    }

    return character;
  }

  /**
   * Finds several Characters by identifier.
   *
   * @param characterIds - The Characters to find.
   * @returns The Characters that exist.
   */
  findByIds(characterIds: string[]): Promise<StorytimeCharacterEntity[]> {
    if (characterIds.length === 0) {
      return Promise.resolve([]);
    }

    return this._characterRepository.find({
      where: { id: In(characterIds) },
    });
  }

  /**
   * Reorders a Story's cast.
   *
   * Every Character must be named. A partial list would leave the rest at
   * positions that no longer mean anything relative to the ones that moved.
   *
   * @param storyId - The Story.
   * @param characterIds - Every Character, in the order they should appear.
   * @param actingUserId - The caller.
   * @returns The cast in its new order.
   * @throws BadRequestException when the list does not match the cast.
   */
  async reorder(
    storyId: string,
    characterIds: string[],
    actingUserId: string,
  ): Promise<StorytimeCharacterEntity[]> {
    await this._storyService.findEditableOrFail(
      storyId,
      actingUserId,
      StoryCapability.MANAGE_CHARACTERS,
    );

    const characters = await this._characterRepository.find({
      where: { storyId },
    });

    const ordered = this.resolveWholeCast(characters, characterIds);
    const positions = this._orderingService.renumber(characterIds);

    ordered.forEach((character, position) => {
      character.displayOrder = positions[position].orderIndex;
      character.updatedByUserId = actingUserId;
    });

    await this._characterRepository.save(ordered);

    return ordered;
  }

  /**
   * Deletes a Character.
   *
   * Soft-deleted so its appearances and any links to it survive as history,
   * and so the slug it held is not immediately reissued to somebody else.
   *
   * @param characterId - The Character to delete.
   * @param actingUserId - The caller.
   */
  async remove(characterId: string, actingUserId: string): Promise<void> {
    const character = await this.findEditableOrFail(characterId, actingUserId);

    character.deletedByUserId = actingUserId;
    await this._characterRepository.save(character);
    await this._characterRepository.softDelete(characterId);

    this._logger.log(
      `Character '${character.slug}' deleted by ${actingUserId}`,
    );
  }

  /**
   * Replaces a Character's portrait.
   *
   * @param characterId - The Character.
   * @param actingUserId - The caller.
   * @param file - The cropped upload.
   * @param altText - What the portrait shows.
   * @returns The Character, carrying its new portrait.
   * @throws ForbiddenException when the caller may not manage this cast.
   * @throws BadRequestException when the upload is not usable as a portrait.
   */
  async setPortraitImage(
    characterId: string,
    actingUserId: string,
    file: Express.Multer.File,
    altText: string,
  ): Promise<StorytimeCharacterEntity> {
    const character = await this.findEditableOrFail(characterId, actingUserId);
    const replacedImageId = character.portraitImageId;

    character.portraitImageId = await this._imageService.store({
      slot: StorytimeImageSlot.CHARACTER_PORTRAIT,
      userId: actingUserId,
      entityId: characterId,
      file,
    });
    character.portraitImageAlt = altText;
    character.updatedByUserId = actingUserId;
    character.version += 1;

    const saved = await this._characterRepository.save(character);

    // Released only once the Character points at the new portrait, so a failed
    // save leaves an unreferenced image rather than a cast list of gaps.
    await this._imageService.release(replacedImageId);

    return saved;
  }

  /**
   * Takes a Character's portrait away, along with its description.
   *
   * @param characterId - The Character.
   * @param actingUserId - The caller.
   * @returns The Character, without a portrait.
   * @throws ForbiddenException when the caller may not manage this cast.
   */
  async clearPortraitImage(
    characterId: string,
    actingUserId: string,
  ): Promise<StorytimeCharacterEntity> {
    const character = await this.findEditableOrFail(characterId, actingUserId);
    const removedImageId = character.portraitImageId;

    character.portraitImageId = null;
    character.portraitImageAlt = null;
    character.updatedByUserId = actingUserId;
    character.version += 1;

    const saved = await this._characterRepository.save(character);

    await this._imageService.release(removedImageId);

    return saved;
  }

  /**
   * Applies a slug change, retiring the old one so its links keep working.
   *
   * @param character - The Character being updated.
   * @param dto - The requested changes.
   */
  private async applySlugChange(
    character: StorytimeCharacterEntity,
    dto: UpdateStorytimeCharacterDto,
  ): Promise<void> {
    if (dto.slug === undefined || dto.slug === character.slug) {
      return;
    }

    const previousSlug = character.slug;

    character.slug = await this._slugService.generateUniqueSlug({
      desiredSlug: dto.slug,
      title: character.name,
      targetType: StorytimeTargetType.CHARACTER,
      storyId: character.storyId,
      isTakenByLiveEntity: candidate =>
        this.isSlugTaken(character.storyId, candidate, character.id),
    });

    await this._slugService.recordRetiredSlug(
      StorytimeTargetType.CHARACTER,
      character.id,
      previousSlug,
      character.slug,
      character.storyId,
    );
  }

  /**
   * Re-renders the biography when its source changes.
   *
   * @param character - The Character being updated.
   * @param dto - The requested changes.
   */
  private applyBiography(
    character: StorytimeCharacterEntity,
    dto: UpdateStorytimeCharacterDto,
  ): void {
    if (dto.biographySource === undefined) {
      return;
    }

    const rendered = this._markdownService.render(dto.biographySource);

    character.biographySource = dto.biographySource;
    character.biographyHtml = rendered.html;
    character.biographySchemaVersion = rendered.schemaVersion;
  }

  /**
   * Applies the plain profile fields a creator may change.
   *
   * @param character - The Character being updated.
   * @param dto - The requested changes.
   */
  private applyProfileFields(
    character: StorytimeCharacterEntity,
    dto: UpdateStorytimeCharacterDto,
  ): void {
    // Name, slug, biography, traits and version are handled by the caller,
    // which has to render, retire slugs and tidy traits alongside them.
    const { name, slug, biographySource, traits, version, ...changes } = dto;
    void name;
    void slug;
    void biographySource;
    void version;

    Object.assign(character, changes);

    if (traits !== undefined) {
      character.traits = this.normaliseTraits(traits);
    }
  }

  /**
   * Tidies a submitted trait list.
   *
   * Blank entries are dropped rather than stored: a creator who leaves an
   * empty row in the editor means to have nothing there, not to have a trait
   * with no name.
   *
   * @param traits - The submitted traits.
   * @returns The traits worth storing, or null when there are none.
   */
  private normaliseTraits(traits?: string[] | null): string[] | null {
    if (traits === undefined || traits === null) {
      return null;
    }

    const cleaned = traits
      .map(trait => trait.trim())
      .filter(trait => trait.length > 0);

    return cleaned.length > 0 ? cleaned : null;
  }

  /**
   * Puts the Story's cast into the submitted order, refusing a partial one.
   *
   * Validation and lookup together, so the result is known to hold every
   * Character exactly once and the caller has no impossible case left to
   * defend against. A partial list would leave the Characters nobody named at
   * positions that no longer mean anything relative to the ones that moved.
   *
   * @param characters - The Story's cast.
   * @param characterIds - The submitted order.
   * @returns The cast, in the submitted order.
   * @throws BadRequestException when the list does not match the cast.
   */
  private resolveWholeCast(
    characters: StorytimeCharacterEntity[],
    characterIds: string[],
  ): StorytimeCharacterEntity[] {
    const byId = new Map(
      characters.map(character => [character.id, character]),
    );
    const ordered = characterIds
      .map(id => byId.get(id))
      .filter(
        (character): character is StorytimeCharacterEntity =>
          character !== undefined,
      );

    if (
      ordered.length !== characterIds.length ||
      ordered.length !== characters.length ||
      new Set(characterIds).size !== characterIds.length
    ) {
      throw new BadRequestException(
        'The new order must list every Character in the Story exactly once.',
      );
    }

    return ordered;
  }

  /**
   * Requires that the Story has room for another Character.
   *
   * @param storyId - The Story.
   * @param actingUserId - The caller, whose exemptions apply.
   * @throws Error when the Story is at its limit.
   */
  private async assertWithinCharacterLimit(
    storyId: string,
    actingUserId: string,
  ): Promise<void> {
    const used = await this._characterRepository.count({ where: { storyId } });

    await this._limitService.assertWithinLimit(
      actingUserId,
      STORYTIME_LIMITS.MAX_CHARACTERS_PER_STORY.key,
      STORYTIME_LIMITS.MAX_CHARACTERS_PER_STORY.defaultValue,
      used,
    );
  }

  /**
   * Reports whether a slug is already used by a live Character of the Story.
   *
   * @param storyId - The Story.
   * @param slug - The candidate slug.
   * @param exceptCharacterId - A Character to ignore, when renaming it.
   * @returns True when the slug is taken.
   */
  private async isSlugTaken(
    storyId: string,
    slug: string,
    exceptCharacterId?: string,
  ): Promise<boolean> {
    const count = await this._characterRepository.count({
      where: {
        storyId,
        slug,
        deletedAt: IsNull(),
        ...(exceptCharacterId ? { id: Not(exceptCharacterId) } : {}),
      },
    });

    return count > 0;
  }

  /**
   * Works out where a new Character joins the cast list.
   *
   * @param storyId - The Story.
   * @returns The display order for the new Character.
   */
  private async nextDisplayOrder(storyId: string): Promise<number> {
    const last = await this._characterRepository.findOne({
      where: { storyId },
      order: { displayOrder: 'DESC' },
    });

    return this._orderingService.nextIndex(last?.displayOrder ?? null);
  }
}
