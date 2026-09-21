import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { IsNull, Not, QueryFailedError } from 'typeorm';

import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { FleetAuthorisationRevisionService } from '../authorisation/fleet-authorisation-revision.service';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { FleetPlatformService } from './fleet-platform.service';
import { FleetSlugService } from './fleet-slug.service';
import { StoArmadaService } from './sto-armada.service';
import { MAX_REPORTED_DUPLICATES } from './sto-fleet.service';

describe('StoArmadaService', () => {
  let service: StoArmadaService;
  let armadaRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let platformService: { findByIdOrFail: jest.Mock };
  let slugService: {
    generateUniqueSlug: jest.Mock;
    recordRetiredSlug: jest.Mock;
    findByRetiredSlug: jest.Mock;
  };
  let revisionService: { bump: jest.Mock };

  const communityId = 'f0000000-0000-4000-8000-000000000001';
  const armadaId = 'f0000000-0000-4000-8000-000000000002';
  const platformId = 'f0000000-0000-4000-8000-000000000003';
  const actingUserId = 'f0000000-0000-4000-8000-000000000004';

  /** What the repository will answer `findOne` with. */
  let stored: StoArmadaEntity | null;

  /** What the repository will answer `find` with. */
  let found: StoArmadaEntity[];

  /** What `save` will throw, when a test is exercising a constraint. */
  let saveFailure: unknown;

  /** The slug the mocked slug service will hand back. */
  let mintedSlug: string;

  /** What the availability callback answered when the slug service asked. */
  let candidateWasTaken: boolean | null;

  /** How many live Armadas already hold the candidate slug. */
  let slugHolders: number;

  const platform = { id: platformId, name: 'Windows' } as PlatformEntity;

  const community = {
    id: communityId,
    name: 'Jupiter Force',
    slug: 'jupiter-force',
    visibility: FleetAudience.PUBLIC,
  } as FleetCommunityEntity;

  const buildArmada = (
    overrides: Partial<StoArmadaEntity> = {},
  ): StoArmadaEntity =>
    ({
      id: armadaId,
      communityId,
      platformId,
      platform,
      community,
      exactGameName: 'Sol Armada',
      exactGameNameNormalized: 'sol armada',
      displayName: null,
      slug: 'sol-armada',
      status: FleetScopeStatus.ACTIVE,
      closedAt: null,
      revision: 1,
      deletedAt: null,
      ...overrides,
    }) as StoArmadaEntity;

  /** Where an Armada's slug is unique: one Community, one platform. */
  const armadaScope = {
    targetType: FleetScopeKind.ARMADA,
    communityId,
    platformId,
  };

  beforeEach(async () => {
    stored = buildArmada();
    found = [];
    saveFailure = null;
    mintedSlug = 'sol-armada';
    candidateWasTaken = null;
    slugHolders = 0;

    armadaRepository = {
      findOne: jest.fn(() => Promise.resolve(stored)),
      find: jest.fn(() => Promise.resolve(found)),
      count: jest.fn(() => Promise.resolve(slugHolders)),
      create: jest.fn((values: Partial<StoArmadaEntity>) =>
        buildArmada(values),
      ),
      save: jest.fn((values: StoArmadaEntity) =>
        saveFailure ? Promise.reject(saveFailure) : Promise.resolve(values),
      ),
    };

    platformService = {
      findByIdOrFail: jest.fn(() => Promise.resolve(platform)),
    };

    slugService = {
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
        StoArmadaService,
        {
          provide: getRepositoryToken(StoArmadaEntity),
          useValue: armadaRepository,
        },
        { provide: FleetPlatformService, useValue: platformService },
        { provide: FleetSlugService, useValue: slugService },
        {
          provide: FleetAuthorisationRevisionService,
          useValue: revisionService,
        },
      ],
    }).compile();

    service = module.get<StoArmadaService>(StoArmadaService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('registers the Armada under the Community named in the path', async () => {
      const { armada } = await service.register(
        communityId,
        { exactGameName: 'Sol Armada', platformId },
        actingUserId,
      );

      expect(armada.communityId).toBe(communityId);
      expect(armada.platformId).toBe(platformId);
      expect(armada.slug).toBe('sol-armada');
    });

    it('stores an edge space rather than trimming it away', async () => {
      const { armada } = await service.register(
        communityId,
        { exactGameName: ' Sol Armada', platformId },
        actingUserId,
      );

      expect(armada.exactGameName).toBe(' Sol Armada');
      expect(armada.exactGameNameNormalized).toBe(' sol armada');
    });

    it('asks for a slug scoped to the Community and the platform', async () => {
      await service.register(
        communityId,
        { exactGameName: 'Sol Armada', platformId },
        actingUserId,
      );

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining(armadaScope),
      );
    });

    it('prefers a web address the registrant typed', async () => {
      await service.register(
        communityId,
        { exactGameName: 'Sol Armada', platformId, slug: 'sol' },
        actingUserId,
      );

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining({ desiredSlug: 'sol' }),
      );
    });

    it('counts only live Armadas in the same Community and platform', async () => {
      await service.register(
        communityId,
        { exactGameName: 'Sol Armada', platformId },
        actingUserId,
      );

      expect(candidateWasTaken).toBe(false);
      expect(armadaRepository.count).toHaveBeenCalledWith({
        where: {
          communityId,
          platformId,
          slug: 'sol-armada',
          deletedAt: IsNull(),
        },
      });
    });

    it('reports a candidate another Armada in the scope already holds', async () => {
      slugHolders = 1;

      await service.register(
        communityId,
        { exactGameName: 'Sol Armada', platformId },
        actingUserId,
      );

      expect(candidateWasTaken).toBe(true);
    });

    /**
     * Kept in its own column so a friendly label can never drift into the
     * field that has to match what the game shows. Unlike the exact name it
     * is trimmed, because nothing compares it to anything.
     */
    it('records a display name apart from the name in game', async () => {
      const { armada } = await service.register(
        communityId,
        {
          exactGameName: 'Sol Armada',
          platformId,
          displayName: 'The Sol Lot',
        },
        actingUserId,
      );

      expect(armada.displayName).toBe('The Sol Lot');
      expect(armada.exactGameName).toBe('Sol Armada');
    });

    it('leaves the display name unset when none is given', async () => {
      const { armada } = await service.register(
        communityId,
        { exactGameName: 'Sol Armada', platformId },
        actingUserId,
      );

      expect(armada.displayName).toBeNull();
    });

    it('attaches the platform it already read rather than fetching it again', async () => {
      const { armada } = await service.register(
        communityId,
        { exactGameName: 'Sol Armada', platformId },
        actingUserId,
      );

      expect(armada.platform).toBe(platform);
      expect(platformService.findByIdOrFail).toHaveBeenCalledTimes(1);
    });

    /**
     * Every member Fleet's Community has reason to record the Armada it
     * belongs to, so for an Armada a duplicate is the normal case rather
     * than the exception. Warning and registering anyway is the only answer
     * that does not make the second Community wrong for existing.
     */
    it('reports what already answered to the name, without refusing', async () => {
      const rival = buildArmada({
        id: 'f0000000-0000-4000-8000-00000000000b',
        communityId: 'f0000000-0000-4000-8000-00000000000c',
      });
      found = [rival];

      const { armada, duplicates } = await service.register(
        communityId,
        { exactGameName: 'Sol Armada', platformId },
        actingUserId,
      );

      expect(armada).toBeDefined();
      expect(duplicates).toEqual([rival]);
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
          { exactGameName: 'Sol Armada', platformId },
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
          { exactGameName: 'Sol Armada', platformId },
          actingUserId,
        ),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('lets a failure that is not a query failure through untouched', async () => {
      saveFailure = new Error('the connection went away');

      await expect(
        service.register(
          communityId,
          { exactGameName: 'Sol Armada', platformId },
          actingUserId,
        ),
      ).rejects.toThrow('the connection went away');
    });
  });

  describe('findByIdOrFail', () => {
    /**
     * The Community comes back with it because an Armada has no audience of
     * its own: the read routes apply the Community's, and they cannot do
     * that without it.
     */
    it('reads the Armada with its platform and its Community', async () => {
      const armada = await service.findByIdOrFail(communityId, armadaId);

      expect(armada.id).toBe(armadaId);
      expect(armadaRepository.findOne).toHaveBeenCalledWith({
        where: { id: armadaId, communityId, deletedAt: IsNull() },
        relations: { platform: true, community: true },
      });
    });

    it('reports an Armada in another Community as absent', async () => {
      stored = null;

      await expect(
        service.findByIdOrFail(communityId, armadaId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveBySlugOrFail', () => {
    it('serves the Armada that currently holds the segment', async () => {
      const resolved = await service.resolveBySlugOrFail(
        communityId,
        platformId,
        'sol-armada',
      );

      expect(resolved.armada.id).toBe(armadaId);
      expect(resolved.redirected).toBe(false);
      expect(slugService.findByRetiredSlug).not.toHaveBeenCalled();
    });

    it('follows a retired segment to the Armada that left it behind', async () => {
      armadaRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildArmada());
      slugService.findByRetiredSlug.mockResolvedValue(armadaId);

      const resolved = await service.resolveBySlugOrFail(
        communityId,
        platformId,
        'sol',
      );

      expect(resolved.armada.id).toBe(armadaId);
      expect(resolved.redirected).toBe(true);
      expect(slugService.findByRetiredSlug).toHaveBeenCalledWith(
        armadaScope,
        'sol',
      );
    });

    it('answers absent when nothing ever held the segment', async () => {
      stored = null;

      await expect(
        service.resolveBySlugOrFail(communityId, platformId, 'sol'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers absent when the segment points at an Armada that is gone', async () => {
      stored = null;
      slugService.findByRetiredSlug.mockResolvedValue(armadaId);

      await expect(
        service.resolveBySlugOrFail(communityId, platformId, 'sol'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findDuplicates', () => {
    const whereOf = () =>
      (
        armadaRepository.find.mock.calls[0][0] as {
          where: Array<Record<string, unknown>>;
        }
      ).where;

    it('matches on the case-folded name and the platform', async () => {
      await service.findDuplicates(platformId, 'SOL Armada');

      for (const clause of whereOf()) {
        expect(clause.platformId).toBe(platformId);
        expect(clause.exactGameNameNormalized).toBe('sol armada');
      }
    });

    /**
     * An Armada has no audience of its own, so what may be reported follows
     * the Community holding it.
     */
    it('reports only Armadas in public Communities by default', async () => {
      await service.findDuplicates(platformId, 'Sol Armada');

      expect(whereOf()).toEqual([
        expect.objectContaining({
          community: { visibility: FleetAudience.PUBLIC },
        }),
      ]);
    });

    it('also reports the acting Community’s own records', async () => {
      await service.findDuplicates(platformId, 'Sol Armada', {
        withinCommunityId: communityId,
      });

      expect(whereOf()).toHaveLength(2);
      expect(whereOf()[1]).toEqual(expect.objectContaining({ communityId }));
    });

    it('leaves out a record the caller named and stops at a readable number', async () => {
      await service.findDuplicates(platformId, 'Sol Armada', {
        excludingId: armadaId,
      });

      expect(whereOf()[0].id).toEqual(Not(armadaId));
      expect(armadaRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: MAX_REPORTED_DUPLICATES }),
      );
    });
  });

  describe('update', () => {
    it('changes the settings it was given', async () => {
      const armada = await service.update(
        communityId,
        armadaId,
        { displayName: 'The Sol Lot' },
        actingUserId,
      );

      expect(armada.displayName).toBe('The Sol Lot');
    });

    it('refuses a change made against a revision that has moved on', async () => {
      await expect(
        service.update(communityId, armadaId, { revision: 4 }, actingUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts a change made against the revision it still holds', async () => {
      const armada = await service.update(
        communityId,
        armadaId,
        { revision: 1, displayName: 'The Sol Lot' },
        actingUserId,
      );

      expect(armada.displayName).toBe('The Sol Lot');
    });

    it('re-mints the address when the Armada is renamed', async () => {
      mintedSlug = 'sol-alliance';

      const armada = await service.update(
        communityId,
        armadaId,
        { exactGameName: 'Sol Alliance' },
        actingUserId,
      );

      expect(armada.slug).toBe('sol-alliance');
      expect(armada.exactGameNameNormalized).toBe('sol alliance');
    });

    it('lets the Armada keep its own address while renaming', async () => {
      mintedSlug = 'sol-alliance';

      await service.update(
        communityId,
        armadaId,
        { exactGameName: 'Sol Alliance' },
        actingUserId,
      );

      expect(armadaRepository.count).toHaveBeenCalledWith({
        where: {
          communityId,
          platformId,
          slug: 'sol-alliance',
          deletedAt: IsNull(),
          id: Not(armadaId),
        },
      });
    });

    it('re-mints the address when only the address is changed', async () => {
      mintedSlug = 'sol';

      const armada = await service.update(
        communityId,
        armadaId,
        { slug: 'sol' },
        actingUserId,
      );

      expect(armada.slug).toBe('sol');
      expect(armada.exactGameNameNormalized).toBe('sol armada');
    });

    it('leaves the address alone when neither name nor address changes', async () => {
      await service.update(
        communityId,
        armadaId,
        { displayName: 'The Sol Lot' },
        actingUserId,
      );

      expect(slugService.generateUniqueSlug).not.toHaveBeenCalled();
    });

    it('leaves the old address behind as a redirect', async () => {
      mintedSlug = 'sol-alliance';

      await service.update(
        communityId,
        armadaId,
        { exactGameName: 'Sol Alliance' },
        actingUserId,
      );

      expect(slugService.recordRetiredSlug).toHaveBeenCalledWith(
        armadaScope,
        armadaId,
        'sol-armada',
        'sol-alliance',
      );
    });

    /**
     * An Armada carries no audience of its own, so nothing this route can
     * change alters who may see it. The Community's own visibility does, and
     * bumping for that is the Community's route to do.
     */
    it('never advances the authorisation revision', async () => {
      mintedSlug = 'sol-alliance';

      await service.update(
        communityId,
        armadaId,
        { exactGameName: 'Sol Alliance', displayName: 'The Sol Lot' },
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
        service.update(communityId, armadaId, { slug: 'sol' }, actingUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('close', () => {
    it('closes the Armada rather than deleting it', async () => {
      const armada = await service.close(communityId, armadaId, actingUserId);

      expect(armada.status).toBe(FleetScopeStatus.CLOSED);
      expect(armada.closedAt).toBeInstanceOf(Date);
      expect(armada.deletedAt).toBeNull();
    });

    it('advances the authorisation revision, which closure always must', async () => {
      await service.close(communityId, armadaId, actingUserId);

      expect(revisionService.bump).toHaveBeenCalledWith(
        FleetScopeKind.ARMADA,
        armadaId,
      );
    });

    it('does not move the closure instant when the Armada is already closed', async () => {
      const closedAt = new Date('2026-01-01T00:00:00.000Z');
      stored = buildArmada({ status: FleetScopeStatus.CLOSED, closedAt });

      const armada = await service.close(communityId, armadaId, actingUserId);

      expect(armada.closedAt).toBe(closedAt);
      expect(armadaRepository.save).not.toHaveBeenCalled();
      expect(revisionService.bump).not.toHaveBeenCalled();
    });
  });
});
