import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeArcFollowEntity } from './entities/storytime-arc-follow.entity';
import { StorytimeCreatorFollowEntity } from './entities/storytime-creator-follow.entity';
import { StorytimeStoryFollowEntity } from './entities/storytime-story-follow.entity';

/** What somebody may follow. */
export enum FollowTargetKind {
  /** A person, and everything they publish. */
  CREATOR = 'CREATOR',
  /** One Story, and its new Chapters. */
  STORY = 'STORY',
  /** One Arc, and what joins or leaves it. */
  ARC = 'ARC',
}

/** What one reader follows. */
export interface Follows {
  creatorUserIds: string[];
  storyIds: string[];
  arcIds: string[];
}

/**
 * Following creators, Stories and Arcs.
 *
 * Following is idempotent in both directions: following something already
 * followed changes nothing, and unfollowing something that is not followed is
 * not an error. A button that reports failure for saying what is already true
 * teaches people to distrust it.
 */
@Injectable()
export class StorytimeFollowService {
  /**
   * Creates an instance of StorytimeFollowService.
   *
   * @param _creatorFollowRepository - Follows of people.
   * @param _storyFollowRepository - Follows of Stories.
   * @param _arcFollowRepository - Follows of Arcs.
   */
  constructor(
    @InjectRepository(StorytimeCreatorFollowEntity)
    private readonly _creatorFollowRepository: Repository<StorytimeCreatorFollowEntity>,
    @InjectRepository(StorytimeStoryFollowEntity)
    private readonly _storyFollowRepository: Repository<StorytimeStoryFollowEntity>,
    @InjectRepository(StorytimeArcFollowEntity)
    private readonly _arcFollowRepository: Repository<StorytimeArcFollowEntity>,
  ) {}

  /**
   * Follows something.
   *
   * @param kind - What kind of thing.
   * @param targetId - The thing.
   * @param userId - The follower.
   * @returns True, so a caller can render a followed state without asking.
   * @throws BadRequestException when somebody tries to follow themselves.
   */
  async follow(
    kind: FollowTargetKind,
    targetId: string,
    userId: string,
  ): Promise<boolean> {
    if (kind === FollowTargetKind.CREATOR && targetId === userId) {
      // Following yourself would fill your own feed with your own work, which
      // is the one thing you already know about.
      throw new BadRequestException('You cannot follow yourself.');
    }

    if (await this.isFollowing(kind, targetId, userId)) {
      return true;
    }

    const repository = this.repositoryFor(kind);

    await repository.insert({
      userId,
      [this.columnFor(kind)]: targetId,
    } as never);

    return true;
  }

  /**
   * Stops following something.
   *
   * @param kind - What kind of thing.
   * @param targetId - The thing.
   * @param userId - The follower.
   * @returns False, matching what the caller should now render.
   */
  async unfollow(
    kind: FollowTargetKind,
    targetId: string,
    userId: string,
  ): Promise<boolean> {
    const repository = this.repositoryFor(kind);

    await repository.delete({
      userId,
      [this.columnFor(kind)]: targetId,
    } as never);

    return false;
  }

  /**
   * Whether somebody follows something.
   *
   * @param kind - What kind of thing.
   * @param targetId - The thing.
   * @param userId - The reader.
   * @returns True when they follow it.
   */
  async isFollowing(
    kind: FollowTargetKind,
    targetId: string,
    userId: string,
  ): Promise<boolean> {
    const repository = this.repositoryFor(kind);

    const existing = await repository.findOne({
      where: { userId, [this.columnFor(kind)]: targetId } as never,
    });

    return existing !== null;
  }

  /**
   * Lists everything one reader follows.
   *
   * @param userId - The reader.
   * @returns The creators, Stories and Arcs they follow.
   */
  async findFollows(userId: string): Promise<Follows> {
    const [creators, stories, arcs] = await Promise.all([
      this._creatorFollowRepository.find({ where: { userId } }),
      this._storyFollowRepository.find({ where: { userId } }),
      this._arcFollowRepository.find({ where: { userId } }),
    ]);

    return {
      creatorUserIds: creators.map(follow => follow.creatorUserId),
      storyIds: stories.map(follow => follow.storyId),
      arcIds: arcs.map(follow => follow.arcId),
    };
  }

  /**
   * Counts the followers of something.
   *
   * @param kind - What kind of thing.
   * @param targetId - The thing.
   * @returns How many people follow it.
   */
  countFollowers(kind: FollowTargetKind, targetId: string): Promise<number> {
    const repository = this.repositoryFor(kind);

    return repository.count({
      where: { [this.columnFor(kind)]: targetId } as never,
    });
  }

  /**
   * Names the kind of follow that matches a kind of content.
   *
   * @param targetType - The kind of content.
   * @returns The kind of follow.
   * @throws BadRequestException when that kind cannot be followed.
   */
  kindFor(targetType: StorytimeTargetType): FollowTargetKind {
    switch (targetType) {
      case StorytimeTargetType.STORY:
        return FollowTargetKind.STORY;
      case StorytimeTargetType.ARC:
        return FollowTargetKind.ARC;
      default:
        throw new BadRequestException('That cannot be followed.');
    }
  }

  /**
   * Picks the table for a kind of follow.
   *
   * @param kind - What kind of thing.
   * @returns The repository.
   */
  private repositoryFor(kind: FollowTargetKind): Repository<{ id: string }> {
    switch (kind) {
      case FollowTargetKind.CREATOR:
        return this._creatorFollowRepository as unknown as Repository<{
          id: string;
        }>;
      case FollowTargetKind.STORY:
        return this._storyFollowRepository as unknown as Repository<{
          id: string;
        }>;
      default:
        return this._arcFollowRepository as unknown as Repository<{
          id: string;
        }>;
    }
  }

  /**
   * Names the column identifying what a follow points at.
   *
   * @param kind - What kind of thing.
   * @returns The column name.
   */
  private columnFor(kind: FollowTargetKind): string {
    switch (kind) {
      case FollowTargetKind.CREATOR:
        return 'creatorUserId';
      case FollowTargetKind.STORY:
        return 'storyId';
      default:
        return 'arcId';
    }
  }
}
