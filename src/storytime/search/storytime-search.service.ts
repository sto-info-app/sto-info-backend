import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { ArcStatus } from '../enums/arc-status.enum';
import { ChapterStatus } from '../enums/chapter-status.enum';
import { StoryStatus } from '../enums/story-status.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { SearchQueryDto } from './dto/search-query.dto';

/** Results per page when a caller does not ask for a size. */
const DEFAULT_PAGE_SIZE = 20;

/** The most results of one kind considered before merging. */
const MAX_PER_TYPE = 100;

/**
 * One thing search found, whatever kind of thing it is.
 */
export interface SearchHit {
  /** What kind of content matched. */
  targetType: StorytimeTargetType;
  /** The content. */
  id: string;
  /** Its own address. */
  slug: string;
  /** What it is called. */
  title: string;
  /** A line to show under the title, when there is one. */
  summary: string | null;
  /** The Story it belongs to, for a Chapter or a Character. */
  storySlug: string | null;
  /** How well it matched, for ordering. */
  rank: number;
}

/** A page of search results. */
export interface SearchResults {
  items: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
  /** How many of each kind matched, so a client can offer counts. */
  countsByType: Record<string, number>;
}

/**
 * Searching published Storytime content.
 *
 * Runs against the weighted vectors the database maintains: a title match
 * ranks above a summary match, which ranks above a match buried in the body.
 * That ordering is the difference between finding the Story called Voyager and
 * finding every Story that mentions one.
 *
 * Only publicly listed content is searchable. Unlisted work is readable by
 * anybody holding the link but must never be discoverable by browsing, and
 * search is browsing.
 */
@Injectable()
export class StorytimeSearchService {
  /**
   * Creates an instance of StorytimeSearchService.
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
   * Searches everything a reader may discover.
   *
   * Each kind is searched separately and the results merged by rank, rather
   * than one union query: the four have nothing in common but the vector, and
   * four readable queries beat one that nobody will dare change.
   *
   * @param query - What to look for, and what to look in.
   * @returns The page of results, with a count of each kind that matched.
   */
  async search(query: SearchQueryDto): Promise<SearchResults> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const wanted = query.types?.length
      ? query.types
      : [
          StorytimeTargetType.STORY,
          StorytimeTargetType.CHAPTER,
          StorytimeTargetType.CHARACTER,
          StorytimeTargetType.ARC,
        ];

    const groups = await Promise.all(
      wanted.map(targetType => this.searchOne(targetType, query.q)),
    );

    const hits = groups
      .flat()
      .sort((first, second) => second.rank - first.rank);

    const countsByType = Object.fromEntries(
      wanted.map((targetType, index) => [targetType, groups[index].length]),
    );

    return {
      items: hits.slice((page - 1) * pageSize, page * pageSize),
      total: hits.length,
      page,
      pageSize,
      countsByType,
    };
  }

  /**
   * Searches one kind of content.
   *
   * @param targetType - The kind to search.
   * @param term - What the reader typed.
   * @returns The matches, best first.
   */
  private searchOne(
    targetType: StorytimeTargetType,
    term: string,
  ): Promise<SearchHit[]> {
    switch (targetType) {
      case StorytimeTargetType.CHAPTER:
        return this.searchChapters(term);
      case StorytimeTargetType.CHARACTER:
        return this.searchCharacters(term);
      case StorytimeTargetType.ARC:
        return this.searchArcs(term);
      default:
        return this.searchStories(term);
    }
  }

  /**
   * Searches published, publicly listed Stories.
   *
   * @param term - What the reader typed.
   * @returns The matches, best first.
   */
  private async searchStories(term: string): Promise<SearchHit[]> {
    const builder = this._storyRepository
      .createQueryBuilder('story')
      .select([
        'story.id AS id',
        'story.slug AS slug',
        'story.title AS title',
        'story.shortDescription AS summary',
      ])
      .where('story.status = :status', { status: StoryStatus.PUBLISHED })
      .andWhere('story.visibility = :visibility', {
        visibility: StorytimeVisibility.PUBLIC,
      })
      .andWhere('story.moderationStatus = :moderationStatus', {
        moderationStatus: StorytimeModerationStatus.ACTIVE,
      });

    return this.rank(builder, 'story', term, StorytimeTargetType.STORY);
  }

  /**
   * Searches published Chapters of publicly listed Stories.
   *
   * The Story's own state is checked as well as the Chapter's: a published
   * Chapter of an unpublished Story is not reachable, and offering it in
   * results would be offering a door that does not open.
   *
   * @param term - What the reader typed.
   * @returns The matches, best first.
   */
  private async searchChapters(term: string): Promise<SearchHit[]> {
    const builder = this._chapterRepository
      .createQueryBuilder('chapter')
      .innerJoin(StorytimeStoryEntity, 'story', 'story.id = chapter."storyId"')
      .select([
        'chapter.id AS id',
        'chapter.slug AS slug',
        'chapter.title AS title',
        'chapter.synopsis AS summary',
        'story.slug AS "storySlug"',
      ])
      .where('chapter.status = :chapterStatus', {
        chapterStatus: ChapterStatus.PUBLISHED,
      })
      .andWhere('chapter.moderationStatus = :moderationStatus', {
        moderationStatus: StorytimeModerationStatus.ACTIVE,
      })
      .andWhere('story.status = :storyStatus', {
        storyStatus: StoryStatus.PUBLISHED,
      })
      .andWhere('story.visibility = :visibility', {
        visibility: StorytimeVisibility.PUBLIC,
      })
      .andWhere('story.moderationStatus = :moderationStatus');

    return this.rank(builder, 'chapter', term, StorytimeTargetType.CHAPTER);
  }

  /**
   * Searches Characters of publicly listed Stories.
   *
   * @param term - What the reader typed.
   * @returns The matches, best first.
   */
  private async searchCharacters(term: string): Promise<SearchHit[]> {
    const builder = this._characterRepository
      .createQueryBuilder('character')
      .innerJoin(
        StorytimeStoryEntity,
        'story',
        'story.id = character."storyId"',
      )
      .select([
        'character.id AS id',
        'character.slug AS slug',
        'character.name AS title',
        'character.species AS summary',
        'story.slug AS "storySlug"',
      ])
      .where('character.moderationStatus = :moderationStatus', {
        moderationStatus: StorytimeModerationStatus.ACTIVE,
      })
      .andWhere('story.status = :storyStatus', {
        storyStatus: StoryStatus.PUBLISHED,
      })
      .andWhere('story.visibility = :visibility', {
        visibility: StorytimeVisibility.PUBLIC,
      })
      .andWhere('story.moderationStatus = :moderationStatus');

    return this.rank(builder, 'character', term, StorytimeTargetType.CHARACTER);
  }

  /**
   * Searches published, publicly listed Arcs.
   *
   * @param term - What the reader typed.
   * @returns The matches, best first.
   */
  private async searchArcs(term: string): Promise<SearchHit[]> {
    const builder = this._arcRepository
      .createQueryBuilder('arc')
      .select([
        'arc.id AS id',
        'arc.slug AS slug',
        'arc.title AS title',
        'arc.shortDescription AS summary',
      ])
      .where('arc.status = :status', { status: ArcStatus.PUBLISHED })
      .andWhere('arc.visibility = :visibility', {
        visibility: StorytimeVisibility.PUBLIC,
      })
      .andWhere('arc.moderationStatus = :moderationStatus', {
        moderationStatus: StorytimeModerationStatus.ACTIVE,
      });

    return this.rank(builder, 'arc', term, StorytimeTargetType.ARC);
  }

  /**
   * Applies the search term to a query and reads the ranked rows back.
   *
   * `plainto_tsquery` rather than `to_tsquery`: a reader typing two words
   * should get results, not a syntax error, and nothing a reader types should
   * ever be parsed as query operators.
   *
   * @param builder - The query, already filtered to what may be discovered.
   * @param alias - The table alias carrying the search vector.
   * @param term - What the reader typed.
   * @param targetType - The kind of content being searched.
   * @returns The matches, best first.
   */
  private async rank<T extends object>(
    builder: SelectQueryBuilder<T>,
    alias: string,
    term: string,
    targetType: StorytimeTargetType,
  ): Promise<SearchHit[]> {
    const rows = await builder
      .andWhere(
        `${alias}."searchVector" @@ plainto_tsquery('english', :term)`,
        {
          term,
        },
      )
      .addSelect(
        `ts_rank(${alias}."searchVector", plainto_tsquery('english', :term))`,
        'rank',
      )
      .orderBy('rank', 'DESC')
      .limit(MAX_PER_TYPE)
      .getRawMany<{
        id: string;
        slug: string;
        title: string;
        summary: string | null;
        storySlug?: string;
        rank: string;
      }>();

    return rows.map(row => ({
      targetType,
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      storySlug: row.storySlug ?? null,
      rank: Number(row.rank),
    }));
  }
}
