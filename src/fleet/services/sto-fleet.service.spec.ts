import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { IsNull, Not, QueryFailedError } from 'typeorm';

import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { FleetAuthorisationRevisionService } from '../authorisation/fleet-authorisation-revision.service';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { FleetPlatformService } from './fleet-platform.service';
import { FleetSlugService } from './fleet-slug.service';
import { MAX_REPORTED_DUPLICATES, StoFleetService } from './sto-fleet.service';

describe('StoFleetService', () => {
  let service: StoFleetService;
  let fleetRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let platformService: {
    findByIdOrFail: jest.Mock;
    findBySegmentOrFail: jest.Mock;
  };
  let slugService: {
    generateUniqueSlug: jest.Mock;
    recordRetiredSlug: jest.Mock;
    findByRetiredSlug: jest.Mock;
  };
  let revisionService: { bump: jest.Mock };

  const communityId = 'c0000000-0000-4000-8000-000000000001';
  const fleetId = 'c0000000-0000-4000-8000-000000000002';
  const platformId = 'c0000000-0000-4000-8000-000000000003';
  const actingUserId = 'c0000000-0000-4000-8000-000000000004';

  /** What the repository will answer `findOne` with. */
  let stored: StoFleetEntity | null;

  /** What the repository will answer `find` with. */
  let found: StoFleetEntity[];

  /** What `save` will throw, when a test is exercising a constraint. */
  let saveFailure: unknown;

  /** The slug the mocked slug service will hand back. */
  let mintedSlug: string;

  /** What the availability callback answered when the slug service asked. */
  let candidateWasTaken: boolean | null;

  /** How many live Fleets already hold the candidate slug. */
  let slugHolders: number;

  const platform = { id: platformId, name: 'Windows' } as PlatformEntity;

  const buildFleet = (
    overrides: Partial<StoFleetEntity> = {},
  ): StoFleetEntity =>
    ({
      id: fleetId,
      communityId,
      platformId,
      platform,
      allegianceFactionId: null,
      exactGameName: 'Omega Command',
      exactGameNameNormalized: 'omega command',
      slug: 'omega-command',
      recruitmentState: FleetRecruitmentState.CLOSED,
      visibility: FleetAudience.COMMUNITY,
      lastEffectiveImportAt: null,
      status: FleetScopeStatus.ACTIVE,
      closedAt: null,
      revision: 1,
      deletedAt: null,
      ...overrides,
    }) as StoFleetEntity;

  /** Where a Fleet's slug is unique: one Community, one platform. */
  const fleetScope = {
    targetType: FleetScopeKind.FLEET,
    communityId,
    platformId,
  };

  beforeEach(async () => {
    stored = buildFleet();
    found = [];
    saveFailure = null;
    mintedSlug = 'omega-command';
    candidateWasTaken = null;
    slugHolders = 0;

    fleetRepository = {
      findOne: jest.fn(() => Promise.resolve(stored)),
      find: jest.fn(() => Promise.resolve(found)),
      count: jest.fn(() => Promise.resolve(slugHolders)),
      create: jest.fn((values: Partial<StoFleetEntity>) => buildFleet(values)),
      save: jest.fn((values: StoFleetEntity) =>
        saveFailure ? Promise.reject(saveFailure) : Promise.resolve(values),
      ),
    };

    platformService = {
      findByIdOrFail: jest.fn(() => Promise.resolve(platform)),
      findBySegmentOrFail: jest.fn(() => Promise.resolve(platform)),
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
        StoFleetService,
        {
          provide: getRepositoryToken(StoFleetEntity),
          useValue: fleetRepository,
        },
        { provide: FleetPlatformService, useValue: platformService },
        { provide: FleetSlugService, useValue: slugService },
        {
          provide: FleetAuthorisationRevisionService,
          useValue: revisionService,
        },
      ],
    }).compile();

    service = module.get<StoFleetService>(StoFleetService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('registers the Fleet under the Community named in the path', async () => {
      const { fleet } = await service.register(
        communityId,
        { exactGameName: 'Omega Command', platformId },
        actingUserId,
      );

      expect(fleet.communityId).toBe(communityId);
      expect(fleet.platformId).toBe(platformId);
      expect(fleet.slug).toBe('omega-command');
    });

    /**
     * ADR-0003, and the reason this field exists at all: the stored name has
     * to match what the game shows, character for character, because FC-016
     * compares it to a roster export's filename. Steve has seen a leading
     * space used in game so two Fleets can carry almost the same name, so
     * trimming here would merge two real Fleets into one record.
     */
    it('stores an edge space rather than trimming it away', async () => {
      const { fleet } = await service.register(
        communityId,
        { exactGameName: ' Omega Command', platformId },
        actingUserId,
      );

      expect(fleet.exactGameName).toBe(' Omega Command');
    });

    /**
     * The duplicate column folds case and nothing else. Two names differing
     * only in capitalisation are the same Fleet; two differing by a space are
     * not, and the warning has to be able to tell them apart.
     */
    it('folds only case into the duplicate-detection column', async () => {
      const { fleet } = await service.register(
        communityId,
        { exactGameName: ' OMEGA Command', platformId },
        actingUserId,
      );

      expect(fleet.exactGameNameNormalized).toBe(' omega command');
    });

    it('asks for a slug scoped to the Community and the platform', async () => {
      await service.register(
        communityId,
        { exactGameName: 'Omega Command', platformId },
        actingUserId,
      );

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining(fleetScope),
      );
    });

    it('prefers a web address the registrant typed', async () => {
      await service.register(
        communityId,
        { exactGameName: 'Omega Command', platformId, slug: 'omega' },
        actingUserId,
      );

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining({ desiredSlug: 'omega' }),
      );
    });

    it('counts only live Fleets in the same Community and platform', async () => {
      slugHolders = 0;

      await service.register(
        communityId,
        { exactGameName: 'Omega Command', platformId },
        actingUserId,
      );

      expect(candidateWasTaken).toBe(false);
      expect(fleetRepository.count).toHaveBeenCalledWith({
        where: {
          communityId,
          platformId,
          slug: 'omega-command',
          deletedAt: IsNull(),
        },
      });
    });

    it('reports a candidate another Fleet in the scope already holds', async () => {
      slugHolders = 1;

      await service.register(
        communityId,
        { exactGameName: 'Omega Command', platformId },
        actingUserId,
      );

      expect(candidateWasTaken).toBe(true);
    });

    it('records the allegiance when one is stated', async () => {
      const allegianceFactionId = 'c0000000-0000-4000-8000-00000000000a';

      const { fleet } = await service.register(
        communityId,
        { exactGameName: 'Omega Command', platformId, allegianceFactionId },
        actingUserId,
      );

      expect(fleet.allegianceFactionId).toBe(allegianceFactionId);
    });

    /**
     * Plan section 4.1: allegiance comes from master data and is never
     * inferred out of a roster's Class column. Absent means unknown, and
     * unknown is a fact rather than a gap to be filled in.
     */
    it('leaves the allegiance unknown when none is stated', async () => {
      const { fleet } = await service.register(
        communityId,
        { exactGameName: 'Omega Command', platformId },
        actingUserId,
      );

      expect(fleet.allegianceFactionId).toBeNull();
    });

    it('registers a Fleet already open to applications and already public', async () => {
      const { fleet } = await service.register(
        communityId,
        {
          exactGameName: 'Omega Command',
          platformId,
          recruitmentState: FleetRecruitmentState.OPEN,
          visibility: FleetAudience.PUBLIC,
        },
        actingUserId,
      );

      expect(fleet.recruitmentState).toBe(FleetRecruitmentState.OPEN);
      expect(fleet.visibility).toBe(FleetAudience.PUBLIC);
    });

    /**
     * Left to the column defaults rather than restated here, so the answer to
     * "what does a Fleet start as" lives in one place.
     */
    it('leaves recruitment and audience to the schema when neither is given', async () => {
      await service.register(
        communityId,
        { exactGameName: 'Omega Command', platformId },
        actingUserId,
      );

      const created = fleetRepository.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;

      expect(created).not.toHaveProperty('recruitmentState');
      expect(created).not.toHaveProperty('visibility');
    });

    it('attaches the platform it already read rather than fetching it again', async () => {
      const { fleet } = await service.register(
        communityId,
        { exactGameName: 'Omega Command', platformId },
        actingUserId,
      );

      expect(fleet.platform).toBe(platform);
      expect(platformService.findByIdOrFail).toHaveBeenCalledTimes(1);
    });

    /**
     * FC-013's third acceptance criterion. The registration succeeds and the
     * matches come back with it: two Communities may each hold a record for
     * the same in-game Fleet, so this warns and never refuses.
     */
    it('reports what already answered to the name, without refusing', async () => {
      const rival = buildFleet({
        id: 'c0000000-0000-4000-8000-00000000000b',
        communityId: 'c0000000-0000-4000-8000-00000000000c',
      });
      found = [rival];

      const { fleet, duplicates } = await service.register(
        communityId,
        { exactGameName: 'Omega Command', platformId },
        actingUserId,
      );

      expect(fleet).toBeDefined();
      expect(duplicates).toEqual([rival]);
    });

    it('leaves the record it has just written out of its own warning', async () => {
      await service.register(
        communityId,
        { exactGameName: 'Omega Command', platformId },
        actingUserId,
      );

      const query = fleetRepository.find.mock.calls[0][0] as {
        where: Array<{ id?: unknown }>;
      };

      for (const clause of query.where) {
        expect(clause.id).toEqual(Not(fleetId));
      }
    });

    it('turns a lost race for the web address into a conflict', async () => {
      saveFailure = new QueryFailedError(
        'insert',
        [],
        new Error('duplicate key value violates unique constraint'),
      );

      await expect(
        service.register(
          communityId,
          { exactGameName: 'Omega Command', platformId },
          actingUserId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lets an unrecognised database failure through untranslated', async () => {
      saveFailure = new QueryFailedError(
        'insert',
        [],
        new Error('deadlock detected'),
      );

      await expect(
        service.register(
          communityId,
          { exactGameName: 'Omega Command', platformId },
          actingUserId,
        ),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('lets a failure that is not a query failure through untouched', async () => {
      saveFailure = new Error('the connection went away');

      await expect(
        service.register(
          communityId,
          { exactGameName: 'Omega Command', platformId },
          actingUserId,
        ),
      ).rejects.toThrow('the connection went away');
    });
  });

  describe('findByIdOrFail', () => {
    it('reads the Fleet with its platform', async () => {
      const fleet = await service.findByIdOrFail(communityId, fleetId);

      expect(fleet.id).toBe(fleetId);
      expect(fleetRepository.findOne).toHaveBeenCalledWith({
        where: { id: fleetId, communityId, deletedAt: IsNull() },
        relations: { platform: true },
      });
    });

    /**
     * The Community is part of the query rather than compared afterwards. A
     * `403` for a Fleet held by somebody else would confirm that the Fleet
     * exists, which is the one thing a probe is trying to learn.
     */
    it('reports a Fleet in another Community as absent', async () => {
      stored = null;

      await expect(
        service.findByIdOrFail(communityId, fleetId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveBySlugOrFail', () => {
    it('serves the Fleet that currently holds the segment', async () => {
      const resolved = await service.resolveBySlugOrFail(
        communityId,
        platformId,
        'omega-command',
      );

      expect(resolved.fleet.id).toBe(fleetId);
      expect(resolved.redirected).toBe(false);
      expect(slugService.findByRetiredSlug).not.toHaveBeenCalled();
    });

    it('follows a retired segment to the Fleet that left it behind', async () => {
      // Nothing holds the segment now, and the Fleet that used to is still
      // there: the first read misses and the read behind the history hits.
      fleetRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildFleet());
      slugService.findByRetiredSlug.mockResolvedValue(fleetId);

      const resolved = await service.resolveBySlugOrFail(
        communityId,
        platformId,
        'omega',
      );

      expect(resolved.fleet.id).toBe(fleetId);
      expect(resolved.redirected).toBe(true);
      expect(slugService.findByRetiredSlug).toHaveBeenCalledWith(
        fleetScope,
        'omega',
      );
    });

    it('answers absent when nothing ever held the segment', async () => {
      stored = null;

      await expect(
        service.resolveBySlugOrFail(communityId, platformId, 'omega'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * The history can outlive the row it points at. A dead pointer is a 404
     * rather than an error, because the address genuinely leads nowhere now.
     */
    it('answers absent when the segment points at a Fleet that is gone', async () => {
      stored = null;
      slugService.findByRetiredSlug.mockResolvedValue(fleetId);

      await expect(
        service.resolveBySlugOrFail(communityId, platformId, 'omega'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findDuplicates', () => {
    const whereOf = () =>
      (
        fleetRepository.find.mock.calls[0][0] as {
          where: Array<Record<string, unknown>>;
        }
      ).where;

    it('matches on the case-folded name and the platform', async () => {
      await service.findDuplicates(platformId, 'OMEGA Command');

      for (const clause of whereOf()) {
        expect(clause.platformId).toBe(platformId);
        expect(clause.exactGameNameNormalized).toBe('omega command');
      }
    });

    /**
     * Telling a registrant that a private Fleet in a Community they have
     * nothing to do with shares their name would answer exactly the question
     * a private Fleet exists in order not to answer.
     */
    it('reports only public records and unregistered ones by default', async () => {
      await service.findDuplicates(platformId, 'Omega Command');

      expect(whereOf()).toEqual([
        expect.objectContaining({ visibility: FleetAudience.PUBLIC }),
        expect.objectContaining({ communityId: IsNull() }),
      ]);
    });

    it('also reports the acting Community’s own records, whatever they hide', async () => {
      await service.findDuplicates(platformId, 'Omega Command', {
        withinCommunityId: communityId,
      });

      expect(whereOf()).toHaveLength(3);
      expect(whereOf()[2]).toEqual(expect.objectContaining({ communityId }));
    });

    it('reports the freshest first and stops at a readable number', async () => {
      await service.findDuplicates(platformId, 'Omega Command');

      expect(fleetRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          take: MAX_REPORTED_DUPLICATES,
          order: {
            lastEffectiveImportAt: { direction: 'DESC', nulls: 'LAST' },
            createdAt: 'DESC',
          },
        }),
      );
    });
  });

  describe('update', () => {
    it('changes the settings it was given', async () => {
      const fleet = await service.update(
        communityId,
        fleetId,
        { visibility: FleetAudience.PUBLIC },
        actingUserId,
      );

      expect(fleet.visibility).toBe(FleetAudience.PUBLIC);
    });

    it('refuses a change made against a revision that has moved on', async () => {
      await expect(
        service.update(communityId, fleetId, { revision: 4 }, actingUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts a change made against the revision it still holds', async () => {
      const fleet = await service.update(
        communityId,
        fleetId,
        { revision: 1, recruitmentState: FleetRecruitmentState.OPEN },
        actingUserId,
      );

      expect(fleet.recruitmentState).toBe(FleetRecruitmentState.OPEN);
    });

    it('re-mints the address when the Fleet is renamed', async () => {
      mintedSlug = 'omega-fleet';

      const fleet = await service.update(
        communityId,
        fleetId,
        { exactGameName: 'Omega Fleet' },
        actingUserId,
      );

      expect(fleet.slug).toBe('omega-fleet');
      expect(fleet.exactGameNameNormalized).toBe('omega fleet');
    });

    it('lets the Fleet keep its own address while renaming', async () => {
      mintedSlug = 'omega-fleet';

      await service.update(
        communityId,
        fleetId,
        { exactGameName: 'Omega Fleet' },
        actingUserId,
      );

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining({ targetId: fleetId }),
      );
      expect(fleetRepository.count).toHaveBeenCalledWith({
        where: {
          communityId,
          platformId,
          slug: 'omega-fleet',
          deletedAt: IsNull(),
          id: Not(fleetId),
        },
      });
    });

    it('re-mints the address when only the address is changed', async () => {
      mintedSlug = 'omega';

      const fleet = await service.update(
        communityId,
        fleetId,
        { slug: 'omega' },
        actingUserId,
      );

      expect(fleet.slug).toBe('omega');
      expect(fleet.exactGameNameNormalized).toBe('omega command');
    });

    it('leaves the address alone when neither name nor address changes', async () => {
      await service.update(
        communityId,
        fleetId,
        { visibility: FleetAudience.PUBLIC },
        actingUserId,
      );

      expect(slugService.generateUniqueSlug).not.toHaveBeenCalled();
    });

    it('leaves the old address behind as a redirect', async () => {
      mintedSlug = 'omega-fleet';

      await service.update(
        communityId,
        fleetId,
        { exactGameName: 'Omega Fleet' },
        actingUserId,
      );

      expect(slugService.recordRetiredSlug).toHaveBeenCalledWith(
        fleetScope,
        fleetId,
        'omega-command',
        'omega-fleet',
      );
    });

    /**
     * Only a visibility change alters who may see the Fleet. Bumping on every
     * reworded description would tell every connected client to discard its
     * view for nothing.
     */
    it('advances the authorisation revision when the audience changes', async () => {
      await service.update(
        communityId,
        fleetId,
        { visibility: FleetAudience.PUBLIC },
        actingUserId,
      );

      expect(revisionService.bump).toHaveBeenCalledWith(
        FleetScopeKind.FLEET,
        fleetId,
      );
    });

    it('leaves the authorisation revision alone for a rename', async () => {
      mintedSlug = 'omega-fleet';

      await service.update(
        communityId,
        fleetId,
        { exactGameName: 'Omega Fleet' },
        actingUserId,
      );

      expect(revisionService.bump).not.toHaveBeenCalled();
    });

    it('turns a lost race for the web address into a conflict', async () => {
      saveFailure = new QueryFailedError(
        'update',
        [],
        new Error('duplicate key value violates unique constraint'),
      );

      await expect(
        service.update(communityId, fleetId, { slug: 'omega' }, actingUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('close', () => {
    it('closes the Fleet rather than deleting it', async () => {
      const fleet = await service.close(communityId, fleetId, actingUserId);

      expect(fleet.status).toBe(FleetScopeStatus.CLOSED);
      expect(fleet.closedAt).toBeInstanceOf(Date);
      expect(fleet.deletedAt).toBeNull();
    });

    it('advances the authorisation revision, which closure always must', async () => {
      await service.close(communityId, fleetId, actingUserId);

      expect(revisionService.bump).toHaveBeenCalledWith(
        FleetScopeKind.FLEET,
        fleetId,
      );
    });

    /**
     * The instant of closure is evidence. A retried request has nothing new
     * to say about when it happened, so it must not be able to move it.
     */
    it('does not move the closure instant when the Fleet is already closed', async () => {
      const closedAt = new Date('2026-01-01T00:00:00.000Z');
      stored = buildFleet({ status: FleetScopeStatus.CLOSED, closedAt });

      const fleet = await service.close(communityId, fleetId, actingUserId);

      expect(fleet.closedAt).toBe(closedAt);
      expect(fleetRepository.save).not.toHaveBeenCalled();
      expect(revisionService.bump).not.toHaveBeenCalled();
    });
  });
});
