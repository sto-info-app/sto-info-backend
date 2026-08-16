import { Injectable } from '@nestjs/common';
import { ReaderChapterStatus } from '../enums/reader-chapter-status.enum';
import { StoryDto } from '../stories/dto/story.dto';
import { ChapterProgressDto } from './dto/chapter-progress.dto';
import { LibraryEntryDto } from './dto/library-entry.dto';
import { StoryProgressDto } from './dto/story-progress.dto';
import { StorytimeUserChapterProgressEntity } from './entities/storytime-user-chapter-progress.entity';
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

  /**
   * Maps a reader's library.
   *
   * A Story the reader can no longer reach maps to a null Story rather than
   * being dropped: it still belongs in their own history.
   *
   * @param summaries - The progress summaries.
   * @param stories - The readable Stories, by identifier.
   * @returns The library entries.
   */
  toLibraryDtoList(
    summaries: StoryProgressSummary[],
    stories: Map<string, StoryDto>,
  ): LibraryEntryDto[] {
    return summaries.map(summary => ({
      progress: this.toDto(summary),
      story: stories.get(summary.progress.storyId) ?? null,
    }));
  }

  /**
   * Maps a reader's progress through one Chapter.
   *
   * Only the block anchor crosses the boundary, not the position type it is
   * stored under: the reader page looks up an element id, and would have no
   * use for a kind of position it cannot act on.
   *
   * @param chapterId - The Chapter asked about.
   * @param progress - The stored progress, or null when there is none.
   * @returns The reader-facing Chapter progress.
   */
  toChapterDto(
    chapterId: string,
    progress: StorytimeUserChapterProgressEntity | null,
  ): ChapterProgressDto {
    if (!progress) {
      return {
        chapterId,
        status: ReaderChapterStatus.UNREAD,
        progressPercent: null,
        blockId: null,
        lastReadAt: null,
      };
    }

    return {
      chapterId,
      status: progress.status,
      progressPercent: progress.progressPercent,
      blockId: progress.lastPositionValue,
      lastReadAt: progress.lastReadAt,
    };
  }
}
