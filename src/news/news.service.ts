import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, QueryFailedError, Repository } from 'typeorm';

import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AcceptedAsset } from 'src/file-assets/services/asset-ingress.service';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { ImageIngressService } from 'src/file-assets/services/image-ingress.service';
import { DEFAULT_MULTER_LIMITS } from 'src/shared/constants/file-upload.constants';
import { normaliseToSlug } from 'src/shared/utilities/slug.utility';

import { CreateNewsPostDto } from './dto/create-news-post.dto';
import { NewsQueryDto } from './dto/news-query.dto';
import { UpdateNewsPostDto } from './dto/update-news-post.dto';
import { NewsPostEntity } from './entities/news-post.entity';
import { NewsCategory } from './enums/news-category.enum';
import { NewsStatus } from './enums/news-status.enum';
import { NEWS_COVER_SPEC } from './news-cover.constants';

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

/**
 * Longest readable stem a News slug uses, leaving room for the uniqueness
 * suffix within the column's 280 characters.
 */
const NEWS_SLUG_MAX_LENGTH = 240;

export type NewsCategoryCounts = Partial<Record<NewsCategory, number>>;

export interface PaginatedNews {
  items: NewsPostEntity[];
  total: number;
  page: number;
  pageSize: number;
  /** Number of published posts per category, independent of the active filter. */
  categoryCounts?: NewsCategoryCounts;
}

/** Enough of a neighbouring post to link to it by name. */
export interface NewsNeighbour {
  slug: string;
  title: string;
}

/** A cover on its way to be scanned. */
export interface NewsCoverUpload {
  /** The administrator uploading it. */
  readonly userId: string;
  /** What it shows. */
  readonly altText: string;
  /** The cropped image. */
  readonly file: Express.Multer.File;
}

/**
 * A published post as the public reads it, with the posts either side of it
 * in the site's news so that its page can lead to them.
 */
export type PublishedNewsPost = NewsPostEntity & {
  /** The post published before this one, or null when this is the oldest. */
  previous: NewsNeighbour | null;
  /** The post published after this one, or null when this is the newest. */
  next: NewsNeighbour | null;
};

/**
 * The site's own news.
 *
 * A Community, a Fleet or an Armada keeps its news in the same table
 * (FC-027), so every query here asks for posts naming no Community. That is
 * asked explicitly, every time, rather than left to a default scope: a scoped
 * post reaching the public list, the RSS feed, the sitemap or an
 * administrator's editor would publish it to people its audience excludes.
 */
@Injectable()
export class NewsService {
  /**
   * Creates an instance of NewsService.
   *
   * @param _newsRepository - The news post repository.
   * @param _ingress - Checks a cover over and sends it to be scanned.
   * @param _withdrawal - Takes a published cover down.
   */
  constructor(
    @InjectRepository(NewsPostEntity)
    private readonly _newsRepository: Repository<NewsPostEntity>,
    private readonly _ingress: ImageIngressService,
    private readonly _withdrawal: AssetWithdrawalService,
  ) {}

  /**
   * Lists published posts for public consumption, newest first.
   *
   * @param query - Pagination and category filter.
   * @returns A page of published posts.
   */
  async findPublished(query: NewsQueryDto): Promise<PaginatedNews> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = this.clampPageSize(query.pageSize);

    const [items, total] = await this._newsRepository.findAndCount({
      where: {
        communityId: IsNull(),
        status: NewsStatus.PUBLISHED,
        ...(query.category ? { category: query.category } : {}),
      },
      order: { publishedAt: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const categoryCounts = await this.countPublishedByCategory();

    return { items, total, page, pageSize, categoryCounts };
  }

  /**
   * Counts published posts grouped by category, independent of any active
   * filter, so clients can hide category chips that have no posts.
   *
   * @returns A map of category to published post count.
   */
  private async countPublishedByCategory(): Promise<NewsCategoryCounts> {
    const rows = await this._newsRepository
      .createQueryBuilder('post')
      .select('post.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('post.communityId IS NULL')
      .andWhere('post.status = :status', { status: NewsStatus.PUBLISHED })
      .groupBy('post.category')
      .getRawMany<{ category: NewsCategory; count: string }>();

    const counts: NewsCategoryCounts = {};
    for (const row of rows) {
      counts[row.category] = Number(row.count);
    }
    return counts;
  }

  /**
   * Finds a single published post by its slug, with the posts either side of
   * it in the site's news.
   *
   * @param slug - The post slug.
   * @returns The published post and its neighbours.
   * @throws NotFoundException when no published post matches the slug.
   */
  async findPublishedBySlug(slug: string): Promise<PublishedNewsPost> {
    const post = await this._newsRepository.findOne({
      where: { slug, communityId: IsNull(), status: NewsStatus.PUBLISHED },
    });

    if (!post) {
      throw new NotFoundException('News post not found');
    }

    const [previous, next] = await Promise.all([
      this.neighbourOf(post, 'previous'),
      this.neighbourOf(post, 'next'),
    ]);

    return { ...post, previous, next };
  }

  /**
   * Finds the published post either side of one in the site's news, which
   * lists newest first by `publishedAt`, then `createdAt`. The previous post
   * is the older one, the next the newer, whatever their categories.
   *
   * @param post - The post whose neighbour is wanted.
   * @param direction - Which neighbour.
   * @returns The neighbour's slug and title, or null when there is none.
   */
  private async neighbourOf(
    post: NewsPostEntity,
    direction: 'previous' | 'next',
  ): Promise<NewsNeighbour | null> {
    const older = direction === 'previous';
    const order = older ? 'DESC' : 'ASC';

    // The post's own place, read back from its row rather than sent as
    // parameters: the database keeps these times to the microsecond, and a
    // Date sent back to it is truncated to the millisecond, which made the
    // post come out newer than itself.
    const self = this._newsRepository
      .createQueryBuilder('self')
      .select(['self.publishedAt', 'self.createdAt'])
      .where('self.id = :id', { id: post.id });

    // Row-wise comparison, so the neighbour is found exactly where the list
    // orders the posts, including two published at the same moment.
    const neighbour = await this._newsRepository
      .createQueryBuilder('post')
      .select(['post.slug', 'post.title'])
      .where('post.communityId IS NULL')
      .andWhere('post.status = :status', { status: NewsStatus.PUBLISHED })
      .andWhere(
        `(post.publishedAt, post.createdAt) ${older ? '<' : '>'} (${self.getQuery()})`,
      )
      .setParameters(self.getParameters())
      .orderBy('post.publishedAt', order)
      .addOrderBy('post.createdAt', order)
      .getOne();

    return neighbour ? { slug: neighbour.slug, title: neighbour.title } : null;
  }

  /**
   * Lists all posts (including drafts) for administration. Drafts are listed
   * first (the `news_status_enum` is defined DRAFT-before-PUBLISHED, so the
   * enum's native ordering surfaces them ahead of published posts), then by
   * `publishedAt` newest first, with `createdAt` as a tie-breaker for drafts
   * that have no `publishedAt`.
   *
   * @param query - Pagination and category filter.
   * @returns A page of posts.
   */
  async findAllForAdmin(query: NewsQueryDto): Promise<PaginatedNews> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = this.clampPageSize(query.pageSize);

    const [items, total] = await this._newsRepository.findAndCount({
      where: {
        communityId: IsNull(),
        ...(query.category ? { category: query.category } : {}),
      },
      order: { status: 'ASC', publishedAt: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { items, total, page, pageSize };
  }

  /**
   * Finds any of the site's posts by ID, regardless of status (admin use).
   *
   * A scoped post is not found here, which is what keeps the site's editor,
   * and its publish and delete routes, off a Fleet's news.
   *
   * @param id - The post ID.
   * @returns The post.
   * @throws NotFoundException when no post matches the ID.
   */
  async findOneById(id: string): Promise<NewsPostEntity> {
    const post = await this._newsRepository.findOne({
      where: { id, communityId: IsNull() },
    });

    if (!post) {
      throw new NotFoundException('News post not found');
    }

    return post;
  }

  /**
   * Creates a news post.
   *
   * @param dto - The post data.
   * @param authorId - The authenticated administrator's user ID.
   * @returns The created post.
   * @throws ConflictException when the slug is already in use.
   */
  async create(
    dto: CreateNewsPostDto,
    authorId: string,
  ): Promise<NewsPostEntity> {
    const status = dto.status ?? NewsStatus.DRAFT;
    const post = this._newsRepository.create({
      title: dto.title,
      slug: dto.slug?.trim() || this.slugify(dto.title),
      summary: dto.summary ?? null,
      body: dto.body,
      category: dto.category,
      status,
      publishedAt: status === NewsStatus.PUBLISHED ? new Date() : null,
      authorId,
    });

    return this.saveHandlingSlugConflict(post);
  }

  /**
   * Updates a news post. Transitioning to PUBLISHED stamps `publishedAt` if not
   * already set; reverting to DRAFT clears it.
   *
   * @param id - The post ID.
   * @param dto - The partial update.
   * @returns The updated post.
   * @throws NotFoundException when the post does not exist.
   * @throws ConflictException when the new slug is already in use.
   */
  async update(id: string, dto: UpdateNewsPostDto): Promise<NewsPostEntity> {
    const post = await this.findOneById(id);

    if (dto.title !== undefined) post.title = dto.title;
    if (dto.slug !== undefined) post.slug = dto.slug.trim();
    if (dto.summary !== undefined) post.summary = dto.summary ?? null;
    if (dto.body !== undefined) post.body = dto.body;
    if (dto.category !== undefined) post.category = dto.category;

    if (dto.status !== undefined && dto.status !== post.status) {
      post.status = dto.status;
      if (dto.status === NewsStatus.PUBLISHED) {
        post.publishedAt = post.publishedAt ?? new Date();
      } else {
        post.publishedAt = null;
      }
    }

    return this.saveHandlingSlugConflict(post);
  }

  /**
   * Publishes a post immediately.
   *
   * @param id - The post ID.
   * @returns The published post.
   * @throws NotFoundException when the post does not exist.
   */
  async publish(id: string): Promise<NewsPostEntity> {
    const post = await this.findOneById(id);
    post.status = NewsStatus.PUBLISHED;
    post.publishedAt = post.publishedAt ?? new Date();
    return this._newsRepository.save(post);
  }

  /**
   * Soft-deletes a post, then takes its cover down.
   *
   * The deleted row keeps naming its cover; what stops the bytes being served
   * is the withdrawal, and a deleted post is never shown to anybody.
   *
   * @param id - The post ID.
   * @throws NotFoundException when the post does not exist.
   */
  async remove(id: string): Promise<void> {
    const post = await this.findOneById(id);
    await this._newsRepository.softRemove(post);

    if (post.coverImageId) {
      await this.withdrawCover(
        post.id,
        post.coverImageId,
        'Its post was deleted',
      );
    }
  }

  /**
   * Sends a post's cover to be scanned (sc-1447). The post keeps showing its
   * old cover, or none, until the scanner clears the new one; publishing is
   * never held up by it.
   *
   * @param id - The post ID.
   * @param upload - The uploader, the description and the file.
   * @returns The upload to ask about, and how far along it is.
   * @throws NotFoundException when the post does not exist.
   * @throws BadRequestException when the file is unacceptable as a cover.
   */
  async setCover(id: string, upload: NewsCoverUpload): Promise<AcceptedAsset> {
    const post = await this.findOneById(id);

    return this._ingress.accept({
      spec: NEWS_COVER_SPEC,
      userId: upload.userId,
      kind: FileAssetKind.NEWS_IMAGE,
      audience: FileAssetAudience.PUBLIC,
      subject: FileAssetSubject.SITE_NEWS_POST,
      subjectId: post.id,
      slot: FileAssetSlot.COVER,
      entityTag: NEWS_COVER_SPEC.entityTag,
      entityId: post.id,
      maximumBytes: DEFAULT_MULTER_LIMITS.fileSize,
      sizeLimitLabel: 'News covers',
      file: upload.file,
      feature: { altText: upload.altText },
    });
  }

  /**
   * Takes a post's cover down.
   *
   * The columns are emptied first, so the post never points at bytes that
   * have stopped being served.
   *
   * @param id - The post ID.
   * @throws NotFoundException when the post does not exist or has no cover.
   */
  async clearCover(id: string): Promise<void> {
    const post = await this.findOneById(id);
    const reference = post.coverImageId;

    if (!reference) {
      throw new NotFoundException('This post has no cover to remove.');
    }

    post.coverImageId = null;
    post.coverImageAlt = null;
    await this._newsRepository.save(post);

    await this.withdrawCover(post.id, reference, 'Removed from its post');
  }

  /**
   * Withdraws the picture a post's cover slot showed.
   *
   * @param postId - The post.
   * @param reference - The cover's delivery reference.
   * @param reason - Why, for the withdrawal record.
   */
  private async withdrawCover(
    postId: string,
    reference: string,
    reason: string,
  ): Promise<void> {
    await this._withdrawal.withdrawSlot(
      FileAssetSubject.SITE_NEWS_POST,
      postId,
      FileAssetSlot.COVER,
      reference,
      reason,
    );
  }

  /**
   * Clamps a requested page size to the supported range.
   *
   * @param requested - The requested page size.
   * @returns A safe page size.
   */
  private clampPageSize(requested?: number): number {
    if (!requested || requested < 1) {
      return DEFAULT_PAGE_SIZE;
    }
    return Math.min(requested, MAX_PAGE_SIZE);
  }

  /**
   * Persists a post, translating slug uniqueness violations into a 409.
   *
   * @param post - The post to save.
   * @returns The saved post.
   * @throws ConflictException on a duplicate slug.
   */
  private async saveHandlingSlugConflict(
    post: NewsPostEntity,
  ): Promise<NewsPostEntity> {
    try {
      return await this._newsRepository.save(post);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        error.message.includes('duplicate key value')
      ) {
        throw new ConflictException('A post with this slug already exists');
      }
      throw error;
    }
  }

  /**
   * Converts a title into a URL-friendly slug.
   *
   * @param title - The source title.
   * @returns The slug.
   */
  private slugify(title: string): string {
    const base = normaliseToSlug(title, NEWS_SLUG_MAX_LENGTH);

    // Ensure uniqueness-friendliness and avoid empty slugs.
    const suffix = Date.now().toString(36);
    return base ? `${base}-${suffix}` : suffix;
  }
}
