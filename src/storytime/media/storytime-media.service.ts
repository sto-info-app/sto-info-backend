import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { YouTubeUrlService } from '../content/youtube-url.service';
import { MediaProvider } from '../enums/media-provider.enum';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { AddChapterMediaDto } from './dto/add-chapter-media.dto';
import { UpdateChapterMediaDto } from './dto/update-chapter-media.dto';
import { StorytimeChapterMediaEntity } from './entities/storytime-chapter-media.entity';

/**
 * The videos a Chapter embeds.
 *
 * A creator pastes a share URL and the server keeps only what it recovered
 * from it: a provider and an identifier. Nothing a creator typed is ever
 * rendered, which is what makes it safe to embed somebody else's video without
 * trusting them.
 *
 * Embedding is a capability of the feature and can be switched off centrally,
 * so a problem with an external service is a configuration change rather than
 * a deployment.
 */
@Injectable()
export class StorytimeMediaService {
  private readonly _logger = new Logger(StorytimeMediaService.name);

  /**
   * Creates an instance of StorytimeMediaService.
   *
   * @param _mediaRepository - Repository of Chapter media.
   * @param _chapterRepository - Repository of Chapters, to resolve the Story.
   * @param _storyService - Decides who may change a Chapter.
   * @param _youTubeUrlService - Recovers a video reference from a share URL.
   * @param _orderingService - Calculates positions within a Chapter's media.
   * @param _featureService - Reports whether embedding is switched on.
   */
  constructor(
    @InjectRepository(StorytimeChapterMediaEntity)
    private readonly _mediaRepository: Repository<StorytimeChapterMediaEntity>,
    @InjectRepository(StorytimeChapterEntity)
    private readonly _chapterRepository: Repository<StorytimeChapterEntity>,
    private readonly _storyService: StorytimeStoryService,
    private readonly _youTubeUrlService: YouTubeUrlService,
    private readonly _orderingService: StorytimeOrderingService,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the media on a Chapter.
   *
   * @param chapterId - The Chapter.
   * @returns The media, in the order the creator arranged it.
   */
  findByChapter(chapterId: string): Promise<StorytimeChapterMediaEntity[]> {
    return this._mediaRepository.find({
      where: { chapterId },
      order: { orderIndex: 'ASC' },
    });
  }

  /**
   * Lists the media across several Chapters at once.
   *
   * @param chapterIds - The Chapters.
   * @returns The media across them all.
   */
  findByChapters(chapterIds: string[]): Promise<StorytimeChapterMediaEntity[]> {
    if (chapterIds.length === 0) {
      return Promise.resolve([]);
    }

    return this._mediaRepository.find({
      where: { chapterId: In(chapterIds) },
      order: { orderIndex: 'ASC' },
    });
  }

  /**
   * Adds a video to a Chapter.
   *
   * @param chapterId - The Chapter.
   * @param dto - The share URL and how to present it.
   * @param actingUserId - The caller.
   * @returns The saved media.
   * @throws BadRequestException when the URL is not an acceptable YouTube link.
   */
  async add(
    chapterId: string,
    dto: AddChapterMediaDto,
    actingUserId: string,
  ): Promise<StorytimeChapterMediaEntity> {
    await this.assertEmbeddingEnabled();

    const chapter = await this.findChapterOrFail(chapterId);

    await this._storyService.findEditableOrFail(
      chapter.storyId,
      actingUserId,
      StoryCapability.MANAGE_CHAPTERS,
    );

    const parsed = this._youTubeUrlService.parse(dto.url);

    if (!parsed) {
      throw new BadRequestException(
        'That does not look like a YouTube link. Paste the address from the video’s Share button.',
      );
    }

    const startSeconds = dto.startSeconds ?? parsed.startSeconds;

    this.assertOffsetsMakeSense(startSeconds, dto.endSeconds ?? null);

    const media = this._mediaRepository.create({
      chapterId,
      provider: MediaProvider.YOUTUBE,
      externalId: parsed.videoId,
      playlistId: parsed.playlistId,
      startSeconds,
      endSeconds: dto.endSeconds ?? null,
      title: dto.title ?? null,
      caption: dto.caption ?? null,
      isPrimary: dto.isPrimary ?? false,
      orderIndex: await this.nextOrderIndex(chapterId),
      createdByUserId: actingUserId,
      updatedByUserId: actingUserId,
    });

    const saved = await this._mediaRepository.save(media);

    this._logger.log(
      `Video ${saved.externalId} added to Chapter ${chapterId} by ${actingUserId}`,
    );

    return saved;
  }

  /**
   * Changes how a video is presented.
   *
   * The video itself is not editable: pointing an existing row at a different
   * video would silently change what a reader sees under a caption written
   * about something else. That is a removal and an addition.
   *
   * @param mediaId - The media.
   * @param dto - The changes.
   * @param actingUserId - The caller.
   * @returns The updated media.
   */
  async update(
    mediaId: string,
    dto: UpdateChapterMediaDto,
    actingUserId: string,
  ): Promise<StorytimeChapterMediaEntity> {
    await this.assertEmbeddingEnabled();

    const media = await this.findEditableOrFail(mediaId, actingUserId);

    const startSeconds =
      dto.startSeconds === undefined ? media.startSeconds : dto.startSeconds;
    const endSeconds =
      dto.endSeconds === undefined ? media.endSeconds : dto.endSeconds;

    this.assertOffsetsMakeSense(startSeconds, endSeconds);

    Object.assign(media, dto);
    media.startSeconds = startSeconds;
    media.endSeconds = endSeconds;
    media.updatedByUserId = actingUserId;

    return this._mediaRepository.save(media);
  }

  /**
   * Removes a video from a Chapter.
   *
   * @param mediaId - The media.
   * @param actingUserId - The caller.
   */
  async remove(mediaId: string, actingUserId: string): Promise<void> {
    await this.assertEmbeddingEnabled();
    await this.findEditableOrFail(mediaId, actingUserId);

    await this._mediaRepository.softDelete(mediaId);
  }

  /**
   * Reorders the media on a Chapter.
   *
   * @param chapterId - The Chapter.
   * @param mediaIds - Every video, in the order it should appear.
   * @param actingUserId - The caller.
   * @returns The media in its new order.
   * @throws BadRequestException when the list does not match the Chapter's media.
   */
  async reorder(
    chapterId: string,
    mediaIds: string[],
    actingUserId: string,
  ): Promise<StorytimeChapterMediaEntity[]> {
    await this.assertEmbeddingEnabled();

    const chapter = await this.findChapterOrFail(chapterId);

    await this._storyService.findEditableOrFail(
      chapter.storyId,
      actingUserId,
      StoryCapability.MANAGE_CHAPTERS,
    );

    const existing = await this.findByChapter(chapterId);
    const ordered = this.resolveWholeList(existing, mediaIds);
    const positions = this._orderingService.renumber(mediaIds);

    ordered.forEach((media, position) => {
      media.orderIndex = positions[position].orderIndex;
      media.updatedByUserId = actingUserId;
    });

    await this._mediaRepository.save(ordered);

    return ordered;
  }

  /**
   * Loads media the caller may change.
   *
   * @param mediaId - The media.
   * @param actingUserId - The caller.
   * @returns The media.
   * @throws NotFoundException when it does not exist.
   */
  private async findEditableOrFail(
    mediaId: string,
    actingUserId: string,
  ): Promise<StorytimeChapterMediaEntity> {
    const media = await this._mediaRepository.findOne({
      where: { id: mediaId },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    const chapter = await this.findChapterOrFail(media.chapterId);

    await this._storyService.findEditableOrFail(
      chapter.storyId,
      actingUserId,
      StoryCapability.MANAGE_CHAPTERS,
    );

    return media;
  }

  /**
   * Loads a Chapter, or fails.
   *
   * @param chapterId - The Chapter.
   * @returns The Chapter.
   * @throws NotFoundException when it does not exist.
   */
  private async findChapterOrFail(
    chapterId: string,
  ): Promise<StorytimeChapterEntity> {
    const chapter = await this._chapterRepository.findOne({
      where: { id: chapterId },
    });

    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    return chapter;
  }

  /**
   * Requires that the offsets describe a stretch of video that exists.
   *
   * Checked here as well as by the database so a creator gets a sentence
   * rather than a constraint violation.
   *
   * @param startSeconds - Where playback should start.
   * @param endSeconds - Where it should stop.
   * @throws BadRequestException when the pair makes no sense.
   */
  private assertOffsetsMakeSense(
    startSeconds: number | null,
    endSeconds: number | null,
  ): void {
    if (endSeconds === null) {
      return;
    }

    if (endSeconds <= (startSeconds ?? 0)) {
      throw new BadRequestException(
        'The end of the clip must come after its start.',
      );
    }
  }

  /**
   * Puts a Chapter's media into the submitted order, refusing a partial list.
   *
   * @param existing - The Chapter's media.
   * @param mediaIds - The submitted order.
   * @returns The media, in the submitted order.
   * @throws BadRequestException when the list does not match.
   */
  private resolveWholeList(
    existing: StorytimeChapterMediaEntity[],
    mediaIds: string[],
  ): StorytimeChapterMediaEntity[] {
    const byId = new Map(existing.map(media => [media.id, media]));
    const ordered = mediaIds
      .map(id => byId.get(id))
      .filter(
        (media): media is StorytimeChapterMediaEntity => media !== undefined,
      );

    if (
      ordered.length !== mediaIds.length ||
      ordered.length !== existing.length ||
      new Set(mediaIds).size !== mediaIds.length
    ) {
      throw new BadRequestException(
        'The new order must list every video on this Chapter exactly once.',
      );
    }

    return ordered;
  }

  /**
   * Works out where a new video joins the Chapter's media.
   *
   * @param chapterId - The Chapter.
   * @returns The order index for the new video.
   */
  private async nextOrderIndex(chapterId: string): Promise<number> {
    const last = await this._mediaRepository.findOne({
      where: { chapterId },
      order: { orderIndex: 'DESC' },
    });

    return this._orderingService.nextIndex(last?.orderIndex ?? null);
  }

  /**
   * Requires that embedding is switched on.
   *
   * Checked on every path that changes media rather than only on the reader
   * page, so switching it off stops new embeds appearing as well as hiding
   * the ones already there.
   */
  private async assertEmbeddingEnabled(): Promise<void> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.YOUTUBE_ENABLED,
    );
  }
}
