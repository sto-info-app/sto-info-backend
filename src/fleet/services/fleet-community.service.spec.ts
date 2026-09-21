import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { IsNull, Not, QueryFailedError } from 'typeorm';

import { FleetAuthorisationRevisionService } from '../authorisation/fleet-authorisation-revision.service';
import { MAX_FLEET_COMMUNITIES_PER_OWNER } from '../constants/fleet-policy.constants';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { FleetCommunityService } from './fleet-community.service';
import { FleetSlugService } from './fleet-slug.service';

describe('FleetCommunityService', () => {
  let service: FleetCommunityService;
  let communityRepository: {
    findOne: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
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
});
