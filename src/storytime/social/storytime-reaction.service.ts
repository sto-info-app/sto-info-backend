import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeReaction } from '../enums/storytime-reaction.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeReactionEntity } from './entities/storytime-reaction.entity';

/** The things a reader may react to. */
export const REACTABLE_TARGET_TYPES = [
  StorytimeTargetType.STORY,
  StorytimeTargetType.CHAPTER,
  StorytimeTargetType.ARC,
] as const;

/** What a reader has done to something, and what everybody else has. */
export interface ReactionSummary {
  /** The thing reacted to. */
  targetId: string;
  /** How many thumbs up it has. */
  upVotes: number;
  /** How many thumbs down. */
  downVotes: number;
  /** Up minus down, which is the number shown. */
  rating: number;
  /** What this reader chose, if anything. */
  mine: StorytimeReaction | null;
}

/**
 * Reactions to Stories, Chapters and Arcs.
 *
 * The rows are the record and the counts on the content are a cache of them,
 * written in the same transaction. Every listing shows a rating, and counting
 * rows per card would be a query per card.
 */
@Injectable()
export class StorytimeReactionService {
  /**
   * Creates an instance of StorytimeReactionService.
   *
   * @param _reactionRepository - Repository of reactions.
   * @param _dataSource - Runs the reaction and its counts as one change.
   */
  constructor(
    @InjectRepository(StorytimeReactionEntity)
    private readonly _reactionRepository: Repository<StorytimeReactionEntity>,
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Records what a reader thinks of something.
   *
   * Reacting the same way twice removes the reaction, because that is what a
   * pressed button means when it is pressed again.
   *
   * @param targetType - What kind of thing.
   * @param targetId - The thing.
   * @param reaction - What they thought of it.
   * @param userId - The reader.
   * @returns The counts afterwards, and what they now hold.
   */
  async react(
    targetType: StorytimeTargetType,
    targetId: string,
    reaction: StorytimeReaction,
    userId: string,
  ): Promise<ReactionSummary> {
    this.assertReactable(targetType);

    const existing = await this._reactionRepository.findOne({
      where: { userId, targetType, targetId },
    });

    if (existing?.reaction === reaction) {
      return this.remove(targetType, targetId, userId);
    }

    await this._dataSource.transaction(async manager => {
      if (existing) {
        existing.reaction = reaction;
        await manager.save(StorytimeReactionEntity, existing);
      } else {
        await manager.save(
          StorytimeReactionEntity,
          manager.create(StorytimeReactionEntity, {
            userId,
            targetType,
            targetId,
            reaction,
          }),
        );
      }

      await this.recount(manager, targetType, targetId);
    });

    return this.summarise(targetType, targetId, userId);
  }

  /**
   * Takes a reader's reaction back.
   *
   * @param targetType - What kind of thing.
   * @param targetId - The thing.
   * @param userId - The reader.
   * @returns The counts afterwards.
   */
  async remove(
    targetType: StorytimeTargetType,
    targetId: string,
    userId: string,
  ): Promise<ReactionSummary> {
    this.assertReactable(targetType);

    await this._dataSource.transaction(async manager => {
      await manager.delete(StorytimeReactionEntity, {
        userId,
        targetType,
        targetId,
      });

      await this.recount(manager, targetType, targetId);
    });

    return this.summarise(targetType, targetId, userId);
  }

  /**
   * Reads the reactions on one thing.
   *
   * @param targetType - What kind of thing.
   * @param targetId - The thing.
   * @param userId - The reader, when there is one signed in.
   * @returns The counts, and what that reader chose.
   */
  async summarise(
    targetType: StorytimeTargetType,
    targetId: string,
    userId?: string | null,
  ): Promise<ReactionSummary> {
    const [summary] = await this.summariseMany(targetType, [targetId], userId);

    return summary;
  }

  /**
   * Reads the reactions on several things of the same kind.
   *
   * Two queries whatever the size of the list: a listing of twenty Stories
   * should not cost forty.
   *
   * @param targetType - What kind of thing.
   * @param targetIds - The things.
   * @param userId - The reader, when there is one signed in.
   * @returns One summary per thing, in the order asked for.
   */
  async summariseMany(
    targetType: StorytimeTargetType,
    targetIds: string[],
    userId?: string | null,
  ): Promise<ReactionSummary[]> {
    if (targetIds.length === 0) {
      return [];
    }

    const rows = await this._reactionRepository.find({
      where: { targetType, targetId: In(targetIds) },
    });

    return targetIds.map(targetId => {
      const forTarget = rows.filter(row => row.targetId === targetId);
      const upVotes = forTarget.filter(
        row => row.reaction === StorytimeReaction.THUMBS_UP,
      ).length;
      const downVotes = forTarget.length - upVotes;

      return {
        targetId,
        upVotes,
        downVotes,
        rating: upVotes - downVotes,
        mine: forTarget.find(row => row.userId === userId)?.reaction ?? null,
      };
    });
  }

  /**
   * Writes the counts back onto the thing that was reacted to.
   *
   * Counted from the rows rather than incremented, so a count can never drift
   * from the reactions that justify it — and a count that has drifted is
   * repaired the next time anybody reacts.
   *
   * @param manager - The transaction doing the work.
   * @param targetType - What kind of thing.
   * @param targetId - The thing.
   */
  private async recount(
    manager: EntityManager,
    targetType: StorytimeTargetType,
    targetId: string,
  ): Promise<void> {
    const rows = await manager.find(StorytimeReactionEntity, {
      where: { targetType, targetId },
    });

    const upVoteCount = rows.filter(
      row => row.reaction === StorytimeReaction.THUMBS_UP,
    ).length;

    await manager.update(
      this.entityFor(targetType),
      { id: targetId },
      { upVoteCount, downVoteCount: rows.length - upVoteCount },
    );
  }

  /**
   * Picks the table carrying the counts for a kind of thing.
   *
   * @param targetType - What kind of thing.
   * @returns The entity class.
   */
  private entityFor(
    targetType: StorytimeTargetType,
  ):
    | typeof StorytimeStoryEntity
    | typeof StorytimeChapterEntity
    | typeof StorytimeArcEntity {
    switch (targetType) {
      case StorytimeTargetType.CHAPTER:
        return StorytimeChapterEntity;
      case StorytimeTargetType.ARC:
        return StorytimeArcEntity;
      default:
        return StorytimeStoryEntity;
    }
  }

  /**
   * Refuses a kind of thing nobody may react to.
   *
   * @param targetType - What kind of thing.
   * @throws BadRequestException when it carries no rating.
   */
  private assertReactable(targetType: StorytimeTargetType): void {
    const reactable = REACTABLE_TARGET_TYPES.includes(
      targetType as (typeof REACTABLE_TARGET_TYPES)[number],
    );

    if (!reactable) {
      throw new BadRequestException('That cannot be reacted to.');
    }
  }
}
