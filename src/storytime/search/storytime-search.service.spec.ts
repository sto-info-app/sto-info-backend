import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeSearchService } from './storytime-search.service';

/** A chainable stub standing in for a TypeORM query builder. */
interface BuilderStub {
  select: jest.Mock;
  innerJoin: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  addSelect: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
  getRawMany: jest.Mock;
}

describe('StorytimeSearchService', () => {
  let service: StorytimeSearchService;
  let builders: Record<string, BuilderStub>;

  /**
   * Builds a chainable query builder stub.
   *
   * @param rows - What the query should return.
   * @returns The stub.
   */
  const buildBuilder = (rows: unknown[] = []): BuilderStub => {
    const builder: Partial<BuilderStub> = {};

    for (const method of [
      'select',
      'innerJoin',
      'where',
      'andWhere',
      'addSelect',
      'orderBy',
      'limit',
    ] as const) {
      builder[method] = jest.fn(() => builder as BuilderStub);
    }

    builder.getRawMany = jest.fn().mockResolvedValue(rows);

    return builder as BuilderStub;
  };

  /**
   * Builds a repository whose query builder returns the given rows.
   *
   * @param key - The name to file the builder under.
   * @param rows - What the query should return.
   * @returns The repository stub.
   */
  const buildRepository = (key: string, rows: unknown[] = []) => {
    builders[key] = buildBuilder(rows);

    return { createQueryBuilder: jest.fn(() => builders[key]) };
  };

  /**
   * Builds the service with the given rows per kind of content.
   *
   * @param rows - The rows each repository should return.
   * @returns Nothing; the service is assigned.
   */
  const configure = async (
    rows: {
      story?: unknown[];
      chapter?: unknown[];
      character?: unknown[];
      arc?: unknown[];
    } = {},
  ): Promise<void> => {
    builders = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeSearchService,
        {
          provide: getRepositoryToken(StorytimeStoryEntity),
          useValue: buildRepository('story', rows.story),
        },
        {
          provide: getRepositoryToken(StorytimeChapterEntity),
          useValue: buildRepository('chapter', rows.chapter),
        },
        {
          provide: getRepositoryToken(StorytimeCharacterEntity),
          useValue: buildRepository('character', rows.character),
        },
        {
          provide: getRepositoryToken(StorytimeArcEntity),
          useValue: buildRepository('arc', rows.arc),
        },
      ],
    }).compile();

    service = module.get<StorytimeSearchService>(StorytimeSearchService);
  };

  /**
   * Collects every `andWhere` condition a builder was given.
   *
   * @param key - Which builder to read.
   * @returns The conditions, as SQL fragments.
   */
  const conditionsOn = (key: string): string =>
    builders[key].andWhere.mock.calls
      .map(call => String(call[0]))
      .concat(builders[key].where.mock.calls.map(call => String(call[0])))
      .join(' ');

  beforeEach(async () => {
    await configure();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('searches every kind of content by default', async () => {
    const results = await service.search({ q: 'voyager' });

    expect(Object.keys(results.countsByType)).toEqual([
      StorytimeTargetType.STORY,
      StorytimeTargetType.CHAPTER,
      StorytimeTargetType.CHARACTER,
      StorytimeTargetType.ARC,
    ]);
  });

  it('searches only the kinds asked for', async () => {
    const results = await service.search({
      q: 'voyager',
      types: [StorytimeTargetType.ARC],
    });

    expect(Object.keys(results.countsByType)).toEqual([
      StorytimeTargetType.ARC,
    ]);
    expect(builders['story'].getRawMany).not.toHaveBeenCalled();
  });

  it('maps a Story hit', async () => {
    await configure({
      story: [
        {
          id: 'story-1',
          slug: 'voyager-home',
          title: 'Voyager Home',
          summary: 'A summary',
          rank: '0.6',
        },
      ],
    });

    const [hit] = (await service.search({ q: 'voyager' })).items;

    expect(hit).toEqual({
      targetType: StorytimeTargetType.STORY,
      id: 'story-1',
      slug: 'voyager-home',
      title: 'Voyager Home',
      summary: 'A summary',
      storySlug: null,
      rank: 0.6,
    });
  });

  // A Chapter is reached through its Story, so a result without the Story's
  // address would be a link nobody could build.
  it('carries the Story a Chapter belongs to', async () => {
    await configure({
      chapter: [
        {
          id: 'chapter-1',
          slug: 'first-contact',
          title: 'First Contact',
          summary: null,
          storySlug: 'voyager-home',
          rank: '0.3',
        },
      ],
    });

    const [hit] = (await service.search({ q: 'voyager' })).items;

    expect(hit.storySlug).toBe('voyager-home');
    expect(hit.targetType).toBe(StorytimeTargetType.CHAPTER);
  });

  it('names a Character by its name and species', async () => {
    await configure({
      character: [
        {
          id: 'character-1',
          slug: 't-vel',
          title: 'T’Vel',
          summary: 'Vulcan',
          storySlug: 'voyager-home',
          rank: '0.4',
        },
      ],
    });

    const [hit] = (await service.search({ q: 'vulcan' })).items;

    expect(hit.title).toBe('T’Vel');
    expect(hit.summary).toBe('Vulcan');
  });

  // The point of the weighted vectors: a title match beats a body mention,
  // whatever kind of content each happens to be.
  it('orders results by how well they matched, across kinds', async () => {
    await configure({
      story: [{ id: 's', slug: 's', title: 'S', summary: null, rank: '0.2' }],
      chapter: [{ id: 'c', slug: 'c', title: 'C', summary: null, rank: '0.9' }],
      arc: [{ id: 'a', slug: 'a', title: 'A', summary: null, rank: '0.5' }],
    });

    const results = await service.search({ q: 'voyager' });

    expect(results.items.map(hit => hit.id)).toEqual(['c', 'a', 's']);
  });

  it('counts how many of each kind matched', async () => {
    await configure({
      story: [
        { id: 's1', slug: 's1', title: 'S', summary: null, rank: '0.2' },
        { id: 's2', slug: 's2', title: 'S', summary: null, rank: '0.1' },
      ],
      arc: [{ id: 'a', slug: 'a', title: 'A', summary: null, rank: '0.5' }],
    });

    const results = await service.search({ q: 'voyager' });

    expect(results.countsByType[StorytimeTargetType.STORY]).toBe(2);
    expect(results.countsByType[StorytimeTargetType.ARC]).toBe(1);
    expect(results.total).toBe(3);
  });

  it('returns the page asked for', async () => {
    await configure({
      story: [
        { id: 's1', slug: 's1', title: 'S', summary: null, rank: '0.9' },
        { id: 's2', slug: 's2', title: 'S', summary: null, rank: '0.5' },
        { id: 's3', slug: 's3', title: 'S', summary: null, rank: '0.1' },
      ],
    });

    const results = await service.search({
      q: 'voyager',
      types: [StorytimeTargetType.STORY],
      page: 2,
      pageSize: 2,
    });

    expect(results.items.map(hit => hit.id)).toEqual(['s3']);
    expect(results.page).toBe(2);
    expect(results.pageSize).toBe(2);
  });

  it('finds nothing when nothing matches', async () => {
    const results = await service.search({ q: 'nothing' });

    expect(results.items).toEqual([]);
    expect(results.total).toBe(0);
  });

  // Nothing a reader types should ever be parsed as query operators, and two
  // words should be a search rather than a syntax error.
  it('treats the search term as plain words', async () => {
    await service.search({ q: 'the long way' });

    const matching = builders['story'].andWhere.mock.calls.find(call =>
      String(call[0]).includes('searchVector'),
    );

    // Only lexemes reach to_tsquery, so nothing typed can be an operator.
    expect(String(matching?.[0])).toContain("to_tsvector('english', :term)");
    // Bound, never interpolated: the term is a reader's text, not SQL.
    expect(matching?.[1]).toEqual({ term: 'the long way' });
  });

  // Somebody typing into a search box has not finished the word yet.
  it('matches every word as a prefix', async () => {
    await service.search({ q: 'pat' });

    const matching = builders['story'].andWhere.mock.calls.find(call =>
      String(call[0]).includes('searchVector'),
    );

    expect(String(matching?.[0])).toContain("lexeme || ':*'");
  });

  describe('what may be found', () => {
    // Unlisted work is readable by link but must never be discoverable by
    // browsing, and search is browsing.
    it('searches only published, publicly listed Stories', async () => {
      await service.search({ q: 'voyager' });

      const applied = conditionsOn('story');

      expect(applied).toContain('story.status');
      expect(applied).toContain('story.visibility');
      expect(applied).toContain('story.moderationStatus');
    });

    // A published Chapter of an unpublished Story is a door that does not
    // open.
    it('checks the Story as well as the Chapter', async () => {
      await service.search({ q: 'voyager' });

      const applied = conditionsOn('chapter');

      expect(applied).toContain('chapter.status');
      expect(applied).toContain('story.status');
      expect(applied).toContain('story.visibility');
    });

    it('checks the Story a Character belongs to', async () => {
      await service.search({ q: 'voyager' });

      const applied = conditionsOn('character');

      expect(applied).toContain('character.moderationStatus');
      expect(applied).toContain('story.visibility');
    });

    it('searches only published, publicly listed Arcs', async () => {
      await service.search({ q: 'voyager' });

      const applied = conditionsOn('arc');

      expect(applied).toContain('arc.status');
      expect(applied).toContain('arc.visibility');
      expect(applied).toContain('arc.moderationStatus');
    });
  });
});
