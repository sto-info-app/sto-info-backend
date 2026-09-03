import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';

/**
 * The moderation columns every moderatable kind of content carries.
 *
 * A shape rather than a base class: the four entities are otherwise unrelated
 * and share no inheritance, and this is all moderation needs from them.
 */
export interface ModeratableFields {
  id: string;
  moderationStatus: StorytimeModerationStatus;
  removedAt: Date | null;
  removedByUserId: string | null;
  moderationReasonCode: string | null;
  moderationMessage: string | null;
  restoredAt: Date | null;
  restoredByUserId: string | null;
}

/**
 * A piece of content an administrator is acting on, with the two things the
 * act needs that the content itself does not always carry.
 */
export interface ModeratedTarget {
  /** The content, with its moderation columns. */
  content: ModeratableFields;
  /**
   * Who answers for it.
   *
   * Resolved through the Story for a Chapter or a Character, because neither
   * has an owner of its own — the Story's owner is who has to be told.
   */
  ownerUserId: string;
  /** What it is called, for the message sent to that person. */
  label: string;
}

/** The kinds of content an administrator may remove and restore. */
export const MODERATABLE_TARGET_TYPES = [
  StorytimeTargetType.STORY,
  StorytimeTargetType.CHAPTER,
  StorytimeTargetType.CHARACTER,
  StorytimeTargetType.ARC,
] as const;

/**
 * Reaching moderatable content whatever kind it is.
 *
 * Moderation is the one part of Storytime that genuinely does not care what it
 * is looking at: an administrator removes a thing, and the rules are the same
 * for a Story, a Chapter, a Character and an Arc. Resolving the target here
 * lets the services above be written once instead of four times.
 *
 * It reads the four tables directly rather than going through their services.
 * Those services enforce ownership and collaboration, which is precisely what
 * an administrator is not subject to, so borrowing them would mean threading
 * an "unless they are an administrator" exception through all of them.
 */
@Injectable()
export class StorytimeModerationTargetService {
  /**
   * Creates an instance of StorytimeModerationTargetService.
   *
   * @param _storyRepository - Repository of Stories.
   * @param _chapterRepository - Repository of Chapters.
   * @param _characterRepository - Repository of Characters.
   * @param _arcRepository - Repository of Arcs.
   */
  constructor(
    @InjectRepository(StorytimeStoryEntity)
    private readonly _storyRepository: Repository<StorytimeStoryEntity>,
    @InjectRepository(StorytimeChapterEntity)
    private readonly _chapterRepository: Repository<StorytimeChapterEntity>,
    @InjectRepository(StorytimeCharacterEntity)
    private readonly _characterRepository: Repository<StorytimeCharacterEntity>,
    @InjectRepository(StorytimeArcEntity)
    private readonly _arcRepository: Repository<StorytimeArcEntity>,
  ) {}

  /**
   * Whether a kind of content can be removed and restored on its own.
   *
   * Media, Crew credits and comments are reportable but are not removed this
   * way: they belong to something else, and moderating them means moderating
   * what they belong to.
   *
   * @param targetType - The kind of content.
   * @returns True when an administrator may act on it directly.
   */
  isModeratable(targetType: StorytimeTargetType): boolean {
    return MODERATABLE_TARGET_TYPES.includes(
      targetType as (typeof MODERATABLE_TARGET_TYPES)[number],
    );
  }

  /**
   * Finds a piece of content of any moderatable kind.
   *
   * @param targetType - The kind of content.
   * @param targetId - The content.
   * @returns The target, or null when nothing matches.
   * @throws BadRequestException when that kind cannot be moderated directly.
   */
  async find(
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<ModeratedTarget | null> {
    switch (targetType) {
      case StorytimeTargetType.STORY:
        return this.fromStory(
          await this._storyRepository.findOne({ where: { id: targetId } }),
        );
      case StorytimeTargetType.ARC:
        return this.fromArc(
          await this._arcRepository.findOne({ where: { id: targetId } }),
        );
      case StorytimeTargetType.CHAPTER: {
        const chapter = await this._chapterRepository.findOne({
          where: { id: targetId },
        });

        return chapter ? this.fromStoryChild(chapter, chapter.title) : null;
      }
      case StorytimeTargetType.CHARACTER: {
        const character = await this._characterRepository.findOne({
          where: { id: targetId },
        });

        return character
          ? this.fromStoryChild(character, character.name)
          : null;
      }
      default:
        throw new BadRequestException(
          `A ${this.describe(targetType).toLowerCase()} cannot be removed on its own.`,
        );
    }
  }

  /**
   * Saves the moderation columns of a piece of content.
   *
   * @param targetType - The kind of content.
   * @param content - The content to save.
   */
  async save(
    targetType: StorytimeTargetType,
    content: ModeratableFields,
  ): Promise<void> {
    switch (targetType) {
      case StorytimeTargetType.STORY:
        await this._storyRepository.save(content as StorytimeStoryEntity);
        return;
      case StorytimeTargetType.CHAPTER:
        await this._chapterRepository.save(content as StorytimeChapterEntity);
        return;
      case StorytimeTargetType.CHARACTER:
        await this._characterRepository.save(
          content as StorytimeCharacterEntity,
        );
        return;
      default:
        await this._arcRepository.save(content as StorytimeArcEntity);
    }
  }

  /**
   * Names a kind of content as a reader would.
   *
   * @param targetType - The kind of content.
   * @returns The word for it.
   */
  describe(targetType: StorytimeTargetType): string {
    const names: Record<StorytimeTargetType, string> = {
      [StorytimeTargetType.STORY]: 'Story',
      [StorytimeTargetType.CHAPTER]: 'Chapter',
      [StorytimeTargetType.CHARACTER]: 'Character',
      [StorytimeTargetType.ARC]: 'Arc',
      [StorytimeTargetType.MEDIA]: 'Media',
      [StorytimeTargetType.CREW_CREDIT]: 'Crew credit',
      [StorytimeTargetType.COMMENT]: 'Comment',
      [StorytimeTargetType.SPOTLIGHT]: 'Spotlight entry',
    };

    return names[targetType];
  }

  /**
   * Builds a target from a Story.
   *
   * @param story - The Story, if it was found.
   * @returns The target, or null.
   */
  private fromStory(
    story: StorytimeStoryEntity | null,
  ): ModeratedTarget | null {
    return story
      ? { content: story, ownerUserId: story.ownerUserId, label: story.title }
      : null;
  }

  /**
   * Builds a target from an Arc.
   *
   * @param arc - The Arc, if it was found.
   * @returns The target, or null.
   */
  private fromArc(arc: StorytimeArcEntity | null): ModeratedTarget | null {
    return arc
      ? { content: arc, ownerUserId: arc.ownerUserId, label: arc.title }
      : null;
  }

  /**
   * Builds a target from something belonging to a Story.
   *
   * The Story is loaded for its owner: a Chapter has nobody of its own to tell.
   *
   * @param child - The Chapter or Character, if it was found.
   * @param label - What it is called.
   * @returns The target, or null when it or its Story has gone.
   */
  private async fromStoryChild(
    child: ModeratableFields & { storyId: string },
    label: string,
  ): Promise<ModeratedTarget | null> {
    const story = await this._storyRepository.findOne({
      where: { id: child.storyId },
    });

    return story
      ? { content: child, ownerUserId: story.ownerUserId, label }
      : null;
  }
}
