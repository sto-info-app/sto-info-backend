import { Injectable } from '@nestjs/common';
import { StoryProgressDto } from './dto/story-progress.dto';
import { StoryProgressSummary } from './storytime-progress.service';

/**
 * Turns progress summaries into the shape the API returns.
 *
 * Only what a reader is shown crosses the boundary. The stored counts the
 * service reasons with — `knownPublishedChapterCount` in particular — stay
 * inside, because they are bookkeeping rather than something anybody reads.
 */
@Injectable()
export class StorytimeProgressMapper {
  /**
   * Maps a progress summary to its response shape.
   *
   * @param summary - The progress and its derived figures.
   * @returns The reader-facing progress.
   */
  toDto(summary: StoryProgressSummary): StoryProgressDto {
    return {
      storyId: summary.progress.storyId,
      status: summary.progress.status,
      totalChapters: summary.totalChapters,
      readChapters: summary.readChapters,
      percentComplete: summary.percentComplete,
      newChapterCount: summary.newChapterCount,
      continueChapterId: summary.continueChapterId,
      lastReadChapterId: summary.progress.lastReadChapterId,
      lastReadAt: summary.progress.lastReadAt,
      completedAt: summary.progress.completedAt,
    };
  }

  /**
   * Maps several progress summaries.
   *
   * @param summaries - The summaries.
   * @returns The reader-facing progress rows.
   */
  toDtoList(summaries: StoryProgressSummary[]): StoryProgressDto[] {
    return summaries.map(summary => this.toDto(summary));
  }
}
