import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { IsNull, Not, QueryFailedError } from 'typeorm';

import { FleetAuthorisationRevisionService } from '../authorisation/fleet-authorisation-revision.service';
import { MAX_FLEET_COMMUNITIES_PER_OWNER } from '../constants/fleet-policy.constants';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetDirectorySort } from '../enums/fleet-directory-sort.enum';
import { FleetDirectoryStatusFilter } from '../enums/fleet-directory-status-filter.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { FleetCommunityService } from './fleet-community.service';
import { FleetSlugService } from './fleet-slug.service';

/** The query-builder methods the directory listing chains. */
interface MockQueryBuilder {
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getManyAndCount: jest.Mock;
}

/**
 * Finds the parameters a condition was added with.
 *
 * @param builder - The query builder mock.
 * @param fragment - Part of the SQL the condition contains.
 * @returns The bound parameters, or undefined when it was never added.
 */
function conditionParameters(
  builder: MockQueryBuilder,
  fragment: string,
): Record<string, unknown> | undefined {
  const call = builder.andWhere.mock.calls.find(([sql]: [unknown]) =>
    String(sql).includes(fragment),
  ) as [string, Record<string, unknown>?] | undefined;

  return call?.[1];
}

/**
 * Reports whether a condition was added at all.
 *
 * @param builder - The query builder mock.
 * @param fragment - Part of the SQL the condition contains.
 * @returns True when something matching was added.
 */
function askedFor(builder: MockQueryBuilder, fragment: string): boolean {
  return builder.andWhere.mock.calls.some(([sql]: [unknown]) =>
    String(sql).includes(fragment),
  );
}

describe('FleetCommunityService', () => {
  let service: FleetCommunityService;
  let communityRepository: {
    findOne: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let slugService: {
    generateUniqueSlug: jest.Mock;
    recordRetiredSlug: jest.Mock;
    findByRetiredSlug: jest.Mock;
  };
  let revisionService: { bump: jest.Mock };

  const ownerUserId = 'b1b2c3d4-0000-4000-8000-000000000001';
  const communityId = 'b1b2c3d4-0000-4000-8000-000000000002';

  /** How many live Communities the owner is holding, for the limit check. */
  let ownedCount: number;

  /** What the repository will answer `findOne` with. */
  let stored: FleetCommunityEntity | null;

  /** What `save` will throw, when a test is exercising a constraint. */
  let saveFailure: unknown;

  /** The slug the mocked slug service will hand back. */
  let mintedSlug: string;

  /** What the availability callback answered when the slug service asked. */
  let candidateWasTaken: boolean | null;

  /** How many live Communities already hold the candidate slug. */
  let slugHolders: number;

  /** The query builder the directory listing was given. */
  let builder: MockQueryBuilder;

  /** What the listing query will answer with. */
  let listed: FleetCommunityEntity[];

  /** How many records the listing query will report in total. */
  let listedTotal: number;

  /**
   * Builds a self-returning query-builder mock.
   *
   * @returns The chainable test double.
   */
  const createQueryBuilderMock = (): MockQueryBuilder => {
    const made = {} as MockQueryBuilder;

    for (const method of [
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ] as const) {
      made[method] = jest.fn(() => made);
    }

    made.getManyAndCount = jest.fn(() =>
      Promise.resolve([listed, listedTotal]),
    );

    builder = made;

    return made;
  };

  const buildCommunity = (
    overrides: Partial<FleetCommunityEntity> = {},
  ): FleetCommunityEntity =>
    ({
      id: communityId,
      ownerUserId,
      name: 'Jupiter Force',
      slug: 'jupiter-force',
      description: null,
      visibility: FleetAudience.PUBLIC,
      status: FleetScopeStatus.ACTIVE,
      closedAt: null,
      revision: 1,
      deletedAt: null,
      ...overrides,
    }) as FleetCommunityEntity;

  /** The scope a Community's own slug is unique in: everywhere. */
  const communityScope = {
    targetType: FleetScopeKind.COMMUNITY,
    communityId: null,
    platformId: null,
  };

  beforeEach(async () => {
    ownedCount = 0;
    stored = buildCommunity();
    saveFailure = null;
    mintedSlug = 'jupiter-force';
    candidateWasTaken = null;
    slugHolders = 0;

    communityRepository = {
      findOne: jest.fn(() => Promise.resolve(stored)),
      // `count` answers two different questions: how many Communities the
      // owner holds, and how many hold a candidate slug. They are told apart
      // by whether the query names a slug at all.
      count: jest.fn((options: { where: { slug?: string } }) =>
        Promise.resolve(
          options.where.slug === undefined ? ownedCount : slugHolders,
        ),
      ),
      create: jest.fn((values: Partial<FleetCommunityEntity>) =>
        buildCommunity(values),
      ),
      save: jest.fn((values: FleetCommunityEntity) =>
        saveFailure ? Promise.reject(saveFailure) : Promise.resolve(values),
      ),
      createQueryBuilder: jest.fn(() => createQueryBuilderMock()),
    };

    slugService = {
      // The real service asks the caller whether a candidate is free, and
      // that callback is the only thing that reaches this service's own
      // availability query. A mock that never called it would leave the
      // question untested.
      generateUniqueSlug: jest.fn(
        async (request: {
          isTakenByLiveScope: (slug: string) => Promise<boolean>;
        }) => {
          candidateWasTaken = await request.isTakenByLiveScope(mintedSlug);

          return mintedSlug;
        },
      ),
      recordRetiredSlug: jest.fn(() => Promise.resolve()),
      findByRetiredSlug: jest.fn(() => Promise.resolve(null)),
    };

    revisionService = { bump: jest.fn(() => Promise.resolve(2)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FleetCommunityService,
        {
          provide: getRepositoryToken(FleetCommunityEntity),
          useValue: communityRepository,
        },
        { provide: FleetSlugService, useValue: slugService },
        {
          provide: FleetAuthorisationRevisionService,
          useValue: revisionService,
        },
      ],
    }).compile();

    service = module.get<FleetCommunityService>(FleetCommunityService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('registers the Community with the caller as its owner', async () => {
      const saved = await service.register(
        { name: 'Jupiter Force' },
        ownerUserId,
      );

      expect(saved.ownerUserId).toBe(ownerUserId);
      expect(saved.slug).toBe('jupiter-force');
    });

    /**
     * R02: the registrant is the Owner from the moment of creation, and
     * `FleetAuthorisationService` reads `ownerUserId` to say so. A role row
     * would mean a Community existing for one statement with nobody able to
     * administer it, so this service deliberately writes none.
     */
    it('creates no role assignment, because ownership is the column', () => {
      expect(communityRepository.save).not.toHaveBeenCalled();
    });

    it('asks for the slug in the Community scope, which has no parent', async () => {
      await service.register({ name: 'Jupiter Force' }, ownerUserId);

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining(communityScope),
      );
    });

    it('prefers a web address the registrant typed', async () => {
      await service.register(
        { name: 'Jupiter Force', slug: 'jupiter' },
        ownerUserId,
      );

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining({ desiredSlug: 'jupiter' }),
      );
    });

    /**
     * The friendly half of the limit. It tells somebody holding ten what the
     * number is instead of showing them a failed insert.
     */
    it('refuses an eleventh Community with the limit in the message', async () => {
      ownedCount = MAX_FLEET_COMMUNITIES_PER_OWNER;

      await expect(
        service.register({ name: 'One Too Many' }, ownerUserId),
      ).rejects.toThrow(
        new ConflictException(
          `You may own at most ${MAX_FLEET_COMMUNITIES_PER_OWNER} Fleet Communities. Close one you no longer run before registering another.`,
        ),
      );
      expect(communityRepository.save).not.toHaveBeenCalled();
    });

    /**
     * The half that is actually load-bearing. Two registrations committing at
     * once cannot see each other's uncommitted rows, so the count above can be
     * overtaken; the trigger holds an advisory lock on the owner and refuses
     * the loser. What arrives here is that refusal, and it has to read as a
     * limit rather than as a server error.
     */
    it('translates the trigger that enforces the limit under a race', async () => {
      saveFailure = new QueryFailedError(
        'INSERT',
        [],
        new Error('a user may own at most 10 live Fleet Communities'),
      );

      await expect(
        service.register({ name: 'Jupiter Force' }, ownerUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('translates a slug taken between the check and the insert', async () => {
      saveFailure = new QueryFailedError(
        'INSERT',
        [],
        new Error(
          'duplicate key value violates unique constraint "UX_fleet_community_slug"',
        ),
      );

      await expect(
        service.register({ name: 'Jupiter Force' }, ownerUserId),
      ).rejects.toThrow('That web address has just been taken');
    });

    /**
     * Anything else is a fault rather than a limit, and dressing it as a 409
     * would tell the caller to change something that was never the problem.
     */
    it('rethrows a query failure it does not recognise', async () => {
      saveFailure = new QueryFailedError(
        'INSERT',
        [],
        new Error('deadlock detected'),
      );

      await expect(
        service.register({ name: 'Jupiter Force' }, ownerUserId),
      ).rejects.toThrow('deadlock detected');
    });

    it('rethrows anything that is not a query failure at all', async () => {
      saveFailure = new Error('the connection went away');

      await expect(
        service.register({ name: 'Jupiter Force' }, ownerUserId),
      ).rejects.toThrow('the connection went away');
    });

    /**
     * Nothing is being renamed, so every live Community counts against the
     * candidate — there is no row yet that is allowed to hold it.
     */
    it('counts every live Community when testing a candidate', async () => {
      await service.register({ name: 'Jupiter Force' }, ownerUserId);

      expect(communityRepository.count).toHaveBeenCalledWith({
        where: { slug: 'jupiter-force', deletedAt: IsNull() },
      });
      expect(candidateWasTaken).toBe(false);
    });

    it('reports a candidate another Community is holding', async () => {
      slugHolders = 1;

      await service.register({ name: 'Jupiter Force' }, ownerUserId);

      expect(candidateWasTaken).toBe(true);
    });
  });

  describe('findByIdOrFail', () => {
    it('reads a Community', async () => {
      await expect(service.findByIdOrFail(communityId)).resolves.toBe(stored);
    });

    it('answers not found when there is none', async () => {
      stored = null;

      await expect(service.findByIdOrFail(communityId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('resolveBySlugOrFail', () => {
    it('serves a live slug without a redirect', async () => {
      await expect(
        service.resolveBySlugOrFail('jupiter-force'),
      ).resolves.toEqual({
        community: stored,
        redirectedFrom: null,
      });
      expect(slugService.findByRetiredSlug).not.toHaveBeenCalled();
    });

    /**
     * A Community may reclaim a slug it used to have. Reading the history
     * first would send it to itself through a redirect that never settles,
     * which is why the live row wins unconditionally.
     */
    it('resolves a retired slug and says where it came from', async () => {
      const live = buildCommunity({ slug: 'jupiter-fleet-command' });

      communityRepository.findOne.mockImplementation(
        (options: { where: { slug?: string } }) =>
          Promise.resolve(options.where.slug ? null : live),
      );
      slugService.findByRetiredSlug.mockResolvedValue(communityId);

      await expect(
        service.resolveBySlugOrFail('jupiter-force'),
      ).resolves.toEqual({
        community: live,
        redirectedFrom: 'jupiter-force',
      });
    });

    it('answers not found when nothing ever held the slug', async () => {
      communityRepository.findOne.mockResolvedValue(null);

      await expect(
        service.resolveBySlugOrFail('never-used'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * The history outlives the row when a Community is erased outright, and a
     * redirect pointing at nothing is a dead address rather than a fault.
     */
    it('answers not found when the redirect points at a Community that is gone', async () => {
      communityRepository.findOne.mockResolvedValue(null);
      slugService.findByRetiredSlug.mockResolvedValue(communityId);

      await expect(
        service.resolveBySlugOrFail('jupiter-force'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('changes the settings it was given', async () => {
      const saved = await service.update(
        communityId,
        { description: 'A PC Community.' },
        ownerUserId,
      );

      expect(saved.description).toBe('A PC Community.');
      expect(slugService.generateUniqueSlug).not.toHaveBeenCalled();
    });

    /**
     * FC-013's second acceptance criterion. A Community's name is a value
     * somebody typed, not a thing derived from whoever owns it: the form
     * offers the registrant's username as a starting point and the server
     * stores whatever came back. Nothing here reads a username, and the
     * name and its web address survive any change that does not name them.
     */
    it('leaves the name and the web address alone when neither was asked about', async () => {
      const saved = await service.update(
        communityId,
        { description: 'A PC Community.' },
        ownerUserId,
      );

      expect(saved.name).toBe('Jupiter Force');
      expect(saved.slug).toBe('jupiter-force');
      expect(slugService.generateUniqueSlug).not.toHaveBeenCalled();
      expect(slugService.recordRetiredSlug).toHaveBeenCalledWith(
        expect.anything(),
        communityId,
        'jupiter-force',
        'jupiter-force',
      );
    });

    /**
     * The owner is not a field this route accepts. Transferring ownership
     * is its own capability and its own ticket; what matters here is that
     * a request cannot rename a Community by claiming to change its owner.
     */
    it('ignores an attempt to change the owner, and keeps the name', async () => {
      const saved = await service.update(
        communityId,
        { ownerUserId: 'somebody-else' } as never,
        ownerUserId,
      );

      expect(saved.ownerUserId).toBe(ownerUserId);
      expect(saved.name).toBe('Jupiter Force');
      expect(saved.slug).toBe('jupiter-force');
    });

    it('refuses an edit made against a revision that has moved on', async () => {
      await expect(
        service.update(communityId, { revision: 1 }, ownerUserId),
      ).resolves.toBeDefined();

      stored = buildCommunity({ revision: 4 });

      await expect(
        service.update(communityId, { revision: 1 }, ownerUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('mints a new slug on a rename and remembers the old one', async () => {
      mintedSlug = 'jupiter-command';

      const saved = await service.update(
        communityId,
        { name: 'Jupiter Command' },
        ownerUserId,
      );

      expect(saved.slug).toBe('jupiter-command');
      expect(slugService.recordRetiredSlug).toHaveBeenCalledWith(
        expect.objectContaining(communityScope),
        communityId,
        'jupiter-force',
        'jupiter-command',
      );
    });

    /**
     * The Community keeps its own slug through a rename, so the availability
     * test has to exclude it. Without that, renaming and changing the name
     * back would suffix the slug it already holds.
     */
    it('lets the Community keep the slug it already has', async () => {
      await service.update(communityId, { slug: 'jupiter' }, ownerUserId);

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining({ targetId: communityId }),
      );
      expect(communityRepository.count).toHaveBeenCalledWith({
        where: {
          slug: 'jupiter-force',
          deletedAt: IsNull(),
          id: Not(communityId),
        },
      });
      expect(candidateWasTaken).toBe(false);
    });

    /**
     * Visibility is the only setting here that changes what somebody is
     * allowed to see, so it is the only one that costs every connected client
     * its cached view.
     */
    it('advances the authorisation revision when visibility changes', async () => {
      await service.update(
        communityId,
        { visibility: FleetAudience.PRIVATE },
        ownerUserId,
      );

      expect(revisionService.bump).toHaveBeenCalledWith(
        FleetScopeKind.COMMUNITY,
        communityId,
      );
    });

    it('leaves the revision alone for a change nobody has to re-read', async () => {
      await service.update(
        communityId,
        { description: 'Now with more detail.' },
        ownerUserId,
      );

      expect(revisionService.bump).not.toHaveBeenCalled();
    });

    it('translates a slug taken between the check and the update', async () => {
      saveFailure = new QueryFailedError(
        'UPDATE',
        [],
        new Error('duplicate key value violates unique constraint'),
      );

      await expect(
        service.update(communityId, { name: 'Jupiter Command' }, ownerUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('close', () => {
    it('closes the Community and records when', async () => {
      const saved = await service.close(communityId, ownerUserId);

      expect(saved.status).toBe(FleetScopeStatus.CLOSED);
      expect(saved.closedAt).toBeInstanceOf(Date);
      expect(saved.deletedAt).toBeNull();
    });

    /** Closure withdraws every mutating capability, so this bump is not optional. */
    it('advances the authorisation revision', async () => {
      await service.close(communityId, ownerUserId);

      expect(revisionService.bump).toHaveBeenCalledWith(
        FleetScopeKind.COMMUNITY,
        communityId,
      );
    });

    /**
     * A retried request must not rewrite when the Community closed. The
     * instant is evidence, and the second call has nothing new to say.
     */
    it('does nothing to a Community that is already closed', async () => {
      const closedAt = new Date('2026-09-01T10:00:00.000Z');
      stored = buildCommunity({
        status: FleetScopeStatus.CLOSED,
        closedAt,
      });

      const saved = await service.close(communityId, ownerUserId);

      expect(saved.closedAt).toBe(closedAt);
      expect(communityRepository.save).not.toHaveBeenCalled();
      expect(revisionService.bump).not.toHaveBeenCalled();
    });
  });

  describe('findDirectoryPage', () => {
    beforeEach(() => {
      listed = [buildCommunity()];
      listedTotal = 1;
    });

    it('lists what anybody may see and nothing else', async () => {
      await service.findDirectoryPage({});

      expect(
        conditionParameters(builder, 'community.visibility'),
      ).toStrictEqual({ listedAudience: FleetAudience.PUBLIC });
    });

    it('hides closed Communities until they are asked for', async () => {
      await service.findDirectoryPage({});

      expect(conditionParameters(builder, 'community.status')).toStrictEqual({
        directoryStatus: FleetScopeStatus.ACTIVE,
      });
    });

    it('lists the closed ones when a reader is checking a name', async () => {
      await service.findDirectoryPage({
        status: FleetDirectoryStatusFilter.CLOSED,
      });

      expect(conditionParameters(builder, 'community.status')).toStrictEqual({
        directoryStatus: FleetScopeStatus.CLOSED,
      });
    });

    it('asks for no state at all when the reader wants every record', async () => {
      await service.findDirectoryPage({
        status: FleetDirectoryStatusFilter.ANY,
      });

      expect(askedFor(builder, 'community.status')).toBe(false);
    });

    /**
     * A Community's name is not the folded in-game name a Fleet carries, so
     * there is no normalised column to match against and the comparison is
     * made in the query instead.
     */
    it('searches the name whatever case it was typed in', async () => {
      await service.findDirectoryPage({ search: 'JUPITER' });

      expect(
        conditionParameters(builder, 'LOWER(community.name) LIKE'),
      ).toStrictEqual({ nameSearch: '%jupiter%' });
    });

    it('escapes a wildcard rather than matching everything', async () => {
      await service.findDirectoryPage({ search: '%' });

      const parameters = conditionParameters(
        builder,
        'LOWER(community.name) LIKE',
      );

      expect(parameters?.nameSearch).toBe(`%${String.fromCodePoint(92)}%%`);
    });

    it('adds no search condition when the box was left empty', async () => {
      await service.findDirectoryPage({});

      expect(askedFor(builder, 'LOWER(community.name) LIKE')).toBe(false);
    });

    it('narrows to a recruitment posture', async () => {
      await service.findDirectoryPage({
        recruitmentState: FleetRecruitmentState.OPEN,
      });

      expect(
        conditionParameters(builder, 'community.recruitmentState'),
      ).toStrictEqual({ recruitmentState: FleetRecruitmentState.OPEN });
    });

    it('orders by name whatever case it was written in', async () => {
      await service.findDirectoryPage({});

      expect(builder.orderBy).toHaveBeenCalledWith(
        'LOWER(community.name)',
        'ASC',
      );
      expect(builder.addOrderBy).toHaveBeenCalledWith('community.id', 'ASC');
    });

    it('orders by registration when asked for the newest', async () => {
      await service.findDirectoryPage({ sort: FleetDirectorySort.NEWEST });

      expect(builder.orderBy).toHaveBeenCalledWith(
        'community.createdAt',
        'DESC',
      );
    });

    it('reads the first page by default', async () => {
      const page = await service.findDirectoryPage({});

      expect(builder.skip).toHaveBeenCalledWith(0);
      expect(builder.take).toHaveBeenCalledWith(20);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(20);
    });

    it('skips the pages before the one asked for', async () => {
      await service.findDirectoryPage({ page: 4, pageSize: 25 });

      expect(builder.skip).toHaveBeenCalledWith(75);
      expect(builder.take).toHaveBeenCalledWith(25);
    });

    it('caps a page at fifty however many were asked for', async () => {
      await service.findDirectoryPage({ pageSize: 5000 });

      expect(builder.take).toHaveBeenCalledWith(50);
    });

    it('reports how many match, not how many were returned', async () => {
      listedTotal = 97;

      const page = await service.findDirectoryPage({});

      expect(page.items).toStrictEqual(listed);
      expect(page.total).toBe(97);
    });
  });
});
