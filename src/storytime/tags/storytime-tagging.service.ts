import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeArcTagEntity } from './entities/storytime-arc-tag.entity';
import { StorytimeCharacterTagEntity } from './entities/storytime-character-tag.entity';
import { StorytimeStoryTagEntity } from './entities/storytime-story-tag.entity';
import { StorytimeTagEntity } from './entities/storytime-tag.entity';
import { StorytimeTagService } from './storytime-tag.service';

/** The kinds of content that can carry tags. */
export const TAGGABLE_TARGET_TYPES = [
  StorytimeTargetType.STORY,
  StorytimeTargetType.ARC,
  StorytimeTargetType.CHARACTER,
] as const;

/**
 * Attaching tags to Stories, Arcs and Characters.
 *
 * Tagging is always a replacement rather than a series of adds and removes:
 * a creator edits the set they want and sends it, which cannot half-apply and
 * needs no separate "untag" call that a client might forget to make.
 */
@Injectable()
export class StorytimeTaggingService {
  /**
   * Creates an instance of StorytimeTaggingService.
   *
   * @param _storyTagRepository - Tags on Stories.
   * @param _arcTagRepository - Tags on Arcs.
   * @param _characterTagRepository - Tags on Characters.
   * @param _tagService - The vocabulary itself.
   */
  constructor(
    @InjectRepository(StorytimeStoryTagEntity)
    private readonly _storyTagRepository: Repository<StorytimeStoryTagEntity>,
    @InjectRepository(StorytimeArcTagEntity)
    private readonly _arcTagRepository: Repository<StorytimeArcTagEntity>,
    @InjectRepository(StorytimeCharacterTagEntity)
    private readonly _characterTagRepository: Repository<StorytimeCharacterTagEntity>,
    private readonly _tagService: StorytimeTagService,
  ) {}

  /**
   * Reads the tags on one piece of content.
   *
   * @param targetType - The kind of content.
   * @param targetId - The content.
   * @returns Its tags, in vocabulary order.
   */
  async findFor(
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<StorytimeTagEntity[]> {
    const rows = await this.rowsFor(targetType, targetId);

    return this.inVocabularyOrder(
      await this._tagService.findByIds(rows.map(row => row.tagId)),
    );
  }

  /**
   * Reads the tags on several pieces of content of the same kind.
   *
   * One query for the join rows and one for the tags, rather than a pair per
   * item: a listing of twenty Stories should not cost forty round trips.
   *
   * @param targetType - The kind of content.
   * @param targetIds - The content.
   * @returns The tags on each, keyed by identifier.
   */
  async findForMany(
    targetType: StorytimeTargetType,
    targetIds: string[],
  ): Promise<Map<string, StorytimeTagEntity[]>> {
    const byTarget = new Map<string, StorytimeTagEntity[]>();

    if (targetIds.length === 0) {
      return byTarget;
    }

    const rows = await this.rowsForMany(targetType, targetIds);
    const tags = await this._tagService.findByIds(rows.map(row => row.tagId));
    const tagsById = new Map(tags.map(tag => [tag.id, tag]));

    for (const row of rows) {
      const tag = tagsById.get(row.tagId);

      if (!tag) {
        continue;
      }

      byTarget.set(row.ownerId, [...(byTarget.get(row.ownerId) ?? []), tag]);
    }

    for (const [ownerId, ownerTags] of byTarget) {
      byTarget.set(ownerId, this.inVocabularyOrder(ownerTags));
    }

    return byTarget;
  }

  /**
   * Sets the tags on one piece of content, replacing whatever was there.
   *
   * @param targetType - The kind of content.
   * @param targetId - The content.
   * @param tagIds - The tags it should carry.
   * @returns The tags it now carries.
   * @throws BadRequestException when a tag does not exist.
   */
  async setTags(
    targetType: StorytimeTargetType,
    targetId: string,
    tagIds: string[],
  ): Promise<StorytimeTagEntity[]> {
    const wanted = [...new Set(tagIds)];
    const tags = await this._tagService.findByIds(wanted);

    if (tags.length !== wanted.length) {
      // A tag that has been deleted since the editor loaded is the usual
      // cause, and silently dropping it would leave the creator believing
      // they had tagged something they had not.
      throw new BadRequestException(
        'One of those tags no longer exists. Reload and try again.',
      );
    }

    const repository = this.repositoryFor(targetType);
    const owner = this.ownerColumnFor(targetType);

    await repository.delete({ [owner]: targetId });

    if (wanted.length > 0) {
      await repository.insert(
        wanted.map(tagId => ({ [owner]: targetId, tagId })) as never,
      );
    }

    return this.inVocabularyOrder(tags);
  }

  /**
   * Finds the content of one kind carrying a tag.
   *
   * @param targetType - The kind of content.
   * @param tagId - The tag.
   * @returns The identifiers of the content carrying it.
   */
  async findTargetsWithTag(
    targetType: StorytimeTargetType,
    tagId: string,
  ): Promise<string[]> {
    const repository = this.repositoryFor(targetType);
    const owner = this.ownerColumnFor(targetType);

    const rows = (await repository.find({
      where: { tagId } as never,
    })) as unknown as Record<string, string>[];

    return rows.map(row => row[owner]);
  }

  /**
   * Reads the join rows for one piece of content.
   *
   * @param targetType - The kind of content.
   * @param targetId - The content.
   * @returns The rows.
   */
  private async rowsFor(
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<{ tagId: string }[]> {
    const repository = this.repositoryFor(targetType);
    const owner = this.ownerColumnFor(targetType);

    return (await repository.find({
      where: { [owner]: targetId },
    })) as unknown as { tagId: string }[];
  }

  /**
   * Reads the join rows for several pieces of content.
   *
   * @param targetType - The kind of content.
   * @param targetIds - The content.
   * @returns The rows, each naming what it belongs to.
   */
  private async rowsForMany(
    targetType: StorytimeTargetType,
    targetIds: string[],
  ): Promise<{ ownerId: string; tagId: string }[]> {
    const repository = this.repositoryFor(targetType);
    const owner = this.ownerColumnFor(targetType);

    const rows = (await repository.find({
      where: { [owner]: In(targetIds) },
    })) as unknown as Record<string, string>[];

    return rows.map(row => ({ ownerId: row[owner], tagId: row['tagId'] }));
  }

  /**
   * Sorts tags the way the vocabulary is arranged.
   *
   * @param tags - The tags to sort.
   * @returns The tags, by category and then by the order set for each.
   */
  private inVocabularyOrder(tags: StorytimeTagEntity[]): StorytimeTagEntity[] {
    return [...tags].sort(
      (first, second) =>
        first.category.localeCompare(second.category) ||
        first.displayOrder - second.displayOrder ||
        first.name.localeCompare(second.name),
    );
  }

  /**
   * Picks the join table for a kind of content.
   *
   * @param targetType - The kind of content.
   * @returns The repository.
   * @throws BadRequestException when that kind cannot be tagged.
   */
  private repositoryFor(
    targetType: StorytimeTargetType,
  ): Repository<{ id: string }> {
    switch (targetType) {
      case StorytimeTargetType.STORY:
        return this._storyTagRepository as unknown as Repository<{
          id: string;
        }>;
      case StorytimeTargetType.ARC:
        return this._arcTagRepository as unknown as Repository<{ id: string }>;
      case StorytimeTargetType.CHARACTER:
        return this._characterTagRepository as unknown as Repository<{
          id: string;
        }>;
      default:
        throw new BadRequestException('That kind of content cannot be tagged.');
    }
  }

  /**
   * Names the column identifying what a join row belongs to.
   *
   * @param targetType - The kind of content.
   * @returns The column name.
   */
  private ownerColumnFor(targetType: StorytimeTargetType): string {
    switch (targetType) {
      case StorytimeTargetType.STORY:
        return 'storyId';
      case StorytimeTargetType.ARC:
        return 'arcId';
      default:
        return 'characterId';
    }
  }
}
