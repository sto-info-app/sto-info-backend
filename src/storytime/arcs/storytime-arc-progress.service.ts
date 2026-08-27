import { Injectable } from '@nestjs/common';
import { StorytimeProgressService } from '../progress/storytime-progress.service';
import { ReaderStoryStatus } from '../enums/reader-story-status.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';

/**
 * How far a reader has got through an Arc.
 */
export interface ArcProgressSummary {
  arcId: string;
  /** Readable Stories in the Arc right now. */
  totalStories: number;
  /** How many of those the reader has finished. */
  completedStories: number;
  /** Whole percent, 0 when the Arc has nothing readable in it. */
  percentComplete: number;
  /** The first Story they have not finished, if any. */
  continueStoryId: string | null;
  /** Where in that Story to pick up, when they have started it. */
  continueChapterId: string | null;
}

/**
 * A reader's progress across an Arc.
 *
 * Derived from Story progress rather than stored, so it can never drift from
 * what the reader has actually read. Storing an Arc percentage would mean
 * updating it every time somebody finished a Chapter of any Story in any Arc
 * that Story belongs to.
 *
 * Only the Stories a reader can open count. An Arc whose later Stories are not
 * published yet reads as complete when the published ones are done, rather
 * than stalling at a percentage nobody can move.
 */
@Injectable()
export class StorytimeArcProgressService {
  /**
   * Creates an instance of StorytimeArcProgressService.
   *
   * @param _progressService - A reader's progress through each Story.
   */
  constructor(private readonly _progressService: StorytimeProgressService) {}

  /**
   * Reports a reader's progress across an Arc.
   *
   * @param userId - The reader.
   * @param arcId - The Arc.
   * @param stories - The readable Stories, in reading order.
   * @returns The progress.
   */
  async summarise(
    userId: string,
    arcId: string,
    stories: StorytimeStoryEntity[],
  ): Promise<ArcProgressSummary> {
    if (stories.length === 0) {
      return {
        arcId,
        totalStories: 0,
        completedStories: 0,
        percentComplete: 0,
        continueStoryId: null,
        continueChapterId: null,
      };
    }

    const progress = await Promise.all(
      stories.map(story =>
        this._progressService.getStoryProgress(userId, story.id),
      ),
    );

    const completedStories = progress.filter(
      summary => summary.progress.status === ReaderStoryStatus.COMPLETED,
    ).length;

    // The first Story that is not finished, which is where "continue" should
    // send them — not the first they have never opened, because a Story left
    // half-read is still the next thing to do.
    const next = progress.find(
      summary => summary.progress.status !== ReaderStoryStatus.COMPLETED,
    );

    return {
      arcId,
      totalStories: stories.length,
      completedStories,
      percentComplete: Math.round((completedStories / stories.length) * 100),
      continueStoryId: next?.progress.storyId ?? null,
      continueChapterId: next?.continueChapterId ?? null,
    };
  }
}
