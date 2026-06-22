import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CreateNewsPostDto } from './dto/create-news-post.dto';
import { NewsQueryDto } from './dto/news-query.dto';
import { UpdateNewsPostDto } from './dto/update-news-post.dto';
import { NewsPostEntity } from './entities/news-post.entity';
import { NewsCategory } from './enums/news-category.enum';
import { NewsStatus } from './enums/news-status.enum';
import {
  COMBINING_DIACRITICS_PATTERN,
  LEADING_HYPHENS_PATTERN,
  NON_ALPHANUMERIC_PATTERN,
  TRAILING_HYPHENS_PATTERN,
} from 'src/shared/constants/regex-patterns.constants';

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

export type NewsCategoryCounts = Partial<Record<NewsCategory, number>>;

export interface PaginatedNews {
  items: NewsPostEntity[];
  total: number;
  page: number;
  pageSize: number;
  /** Number of published posts per category, independent of the active filter. */
  categoryCounts?: NewsCategoryCounts;
}

@Injectable()
export class NewsService {
  /**
   * Creates an instance of NewsService.
   *
   * @param newsRepository - The news post repository.
   */
  constructor(
    @InjectRepository(NewsPostEntity)
    private readonly newsRepository: Repository<NewsPostEntity>,
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

    const [items, total] = await this.newsRepository.findAndCount({
      where: {
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
    const rows = await this.newsRepository
      .createQueryBuilder('post')
      .select('post.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('post.status = :status', { status: NewsStatus.PUBLISHED })
      .groupBy('post.category')
      .getRawMany<{ category: NewsCategory; count: string }>();

    const counts: NewsCategoryCounts = {};
    for (const row of rows) {
      counts[row.category] = Number(row.count);
    }
    return counts;
  }

  /**
   * Finds a single published post by its slug.
   *
   * @param slug - The post slug.
   * @returns The published post.
   * @throws NotFoundException when no published post matches the slug.
   */
  async findPublishedBySlug(slug: string): Promise<NewsPostEntity> {
    const post = await this.newsRepository.findOne({
      where: { slug, status: NewsStatus.PUBLISHED },
    });

    if (!post) {
      throw new NotFoundException('News post not found');
    }

    return post;
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

    const [items, total] = await this.newsRepository.findAndCount({
      where: query.category ? { category: query.category } : {},
      order: { status: 'ASC', publishedAt: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { items, total, page, pageSize };
  }

  /**
   * Finds any post by ID, regardless of status (admin use).
   *
   * @param id - The post ID.
   * @returns The post.
   * @throws NotFoundException when no post matches the ID.
   */
  async findOneById(id: string): Promise<NewsPostEntity> {
    const post = await this.newsRepository.findOne({ where: { id } });

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
    const post = this.newsRepository.create({
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
    return this.newsRepository.save(post);
  }

  /**
   * Soft-deletes a post.
   *
   * @param id - The post ID.
   * @throws NotFoundException when the post does not exist.
   */
  async remove(id: string): Promise<void> {
    const post = await this.findOneById(id);
    await this.newsRepository.softRemove(post);
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
      return await this.newsRepository.save(post);
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
    const base = title
      .toLowerCase()
      .normalize('NFKD')
      .replaceAll(COMBINING_DIACRITICS_PATTERN, '')
      .replaceAll(NON_ALPHANUMERIC_PATTERN, '-')
      .replace(LEADING_HYPHENS_PATTERN, '')
      .replace(TRAILING_HYPHENS_PATTERN, '')
      .slice(0, 240);

    // Ensure uniqueness-friendliness and avoid empty slugs.
    const suffix = Date.now().toString(36);
    return base ? `${base}-${suffix}` : suffix;
  }
}
