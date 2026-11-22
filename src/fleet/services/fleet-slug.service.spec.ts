import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { IsNull } from 'typeorm';

import { FleetSlugHistoryEntity } from '../entities/fleet-slug-history.entity';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import {
  FLEET_SLUG_MAX_LENGTH,
  FleetSlugScope,
  FleetSlugService,
  MAX_FLEET_SLUG_ATTEMPTS,
} from './fleet-slug.service';

describe('FleetSlugService', () => {
  let service: FleetSlugService;
  let historyRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };

  /** Retired slugs the fake repository will answer with. */
  let retired: { slug: string; targetId: string }[];

  /** Slugs a live scope is holding. */
  let live: string[];

  const communityId = 'a1b2c3d4-0000-4000-8000-000000000001';
  const platformId = 'a1b2c3d4-0000-4000-8000-000000000002';
  const targetId = 'a1b2c3d4-0000-4000-8000-000000000003';
  const otherTargetId = 'a1b2c3d4-0000-4000-8000-000000000004';

  /** A Fleet's slug: unique within one Community, on one platform. */
  const fleetScope: FleetSlugScope = {
    targetType: FleetScopeKind.FLEET,
    communityId,
    platformId,
  };

  /** A Community's own slug: unique across the site, so it has no parent. */
  const communityScope: FleetSlugScope = {
    targetType: FleetScopeKind.COMMUNITY,
    communityId: null,
    platformId: null,
  };

  const isTakenByLiveScope = jest.fn((slug: string) =>
    Promise.resolve(live.includes(slug)),
  );

  beforeEach(async () => {
    retired = [];
    live = [];

    historyRepository = {
      findOne: jest.fn((options: { where: { slug: string } }) =>
        Promise.resolve(
          retired.find(row => row.slug === options.where.slug) ?? null,
        ),
      ),
      save: jest.fn((values: unknown) => Promise.resolve(values)),
      create: jest.fn((values: unknown) => values),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FleetSlugService,
        {
          provide: getRepositoryToken(FleetSlugHistoryEntity),
          useValue: historyRepository,
        },
      ],
    }).compile();

    service = module.get<FleetSlugService>(FleetSlugService);
    isTakenByLiveScope.mockClear();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateUniqueSlug', () => {
    it('derives a slug from the exact game name', async () => {
      await expect(
        service.generateUniqueSlug({
          ...fleetScope,
          name: 'The Expeditionary Force',
          isTakenByLiveScope,
        }),
      ).resolves.toBe('the-expeditionary-force');
    });

    /**
     * ADR-0003 accepts the punctuation the corpus actually contains, so the
     * slug has to survive it. Every name here is a real Fleet label from the
     * roster archive.
     */
    it.each([
      ['« Omega Armada »', 'omega-armada'],
      ['- Omega Armada -', 'omega-armada'],
      ['.Darkstar Command.', 'darkstar-command'],
      ["boq botlhra'ghom", 'boq-botlhra-ghom'],
      ['-DME- Division Mu Epsilon', 'dme-division-mu-epsilon'],
      [
        'Ferengi Commerce Authority Bankers',
        'ferengi-commerce-authority-bankers',
      ],
    ])('reduces %s to %s', async (name, expected) => {
      await expect(
        service.generateUniqueSlug({
          ...fleetScope,
          name,
          isTakenByLiveScope,
        }),
      ).resolves.toBe(expected);
    });

    /**
     * A name in a script that does not transliterate leaves nothing a URL can
     * carry. The Fleet still has to be addressable, so the kind stands in.
     */
    it('falls back to the kind when a name reduces to nothing', async () => {
      await expect(
        service.generateUniqueSlug({
          ...fleetScope,
          name: '艦隊オメガ',
          isTakenByLiveScope,
        }),
      ).resolves.toBe('fleet');

      await expect(
        service.generateUniqueSlug({
          ...communityScope,
          name: '!!!',
          isTakenByLiveScope,
        }),
      ).resolves.toBe('community');
    });

    it('prefers a slug the registrant typed', async () => {
      await expect(
        service.generateUniqueSlug({
          ...fleetScope,
          desiredSlug: 'Omega Prime',
          name: 'Something Else Entirely',
          isTakenByLiveScope,
        }),
      ).resolves.toBe('omega-prime');
    });

    it('falls back to the name when the typed slug reduces to nothing', async () => {
      await expect(
        service.generateUniqueSlug({
          ...fleetScope,
          desiredSlug: '///',
          name: 'Jupiter Force',
          isTakenByLiveScope,
        }),
      ).resolves.toBe('jupiter-force');
    });

    it('suffixes when a live scope holds the slug', async () => {
      live = ['jupiter-force'];

      await expect(
        service.generateUniqueSlug({
          ...fleetScope,
          name: 'Jupiter Force',
          isTakenByLiveScope,
        }),
      ).resolves.toBe('jupiter-force-2');
    });

    /**
     * The rule that makes the history worth keeping. A retired slug stays
     * claimed, because an old link resolving to somebody else's Fleet is
     * worse than the dead link the redirect exists to prevent.
     */
    it('will not reissue a slug another scope retired', async () => {
      retired = [{ slug: 'jupiter-force', targetId: otherTargetId }];

      await expect(
        service.generateUniqueSlug({
          ...fleetScope,
          name: 'Jupiter Force',
          isTakenByLiveScope,
        }),
      ).resolves.toBe('jupiter-force-2');
    });

    /** Reverting a rename is ordinary, and the link points where it always did. */
    it('lets a scope reclaim a slug it retired itself', async () => {
      retired = [{ slug: 'jupiter-force', targetId }];

      await expect(
        service.generateUniqueSlug({
          ...fleetScope,
          targetId,
          name: 'Jupiter Force',
          isTakenByLiveScope,
        }),
      ).resolves.toBe('jupiter-force');
    });

    it('keeps a suffixed slug inside the column', async () => {
      const stem = 'a'.repeat(FLEET_SLUG_MAX_LENGTH);

      live = [stem];

      const slug = await service.generateUniqueSlug({
        ...fleetScope,
        name: stem,
        isTakenByLiveScope,
      });

      expect(slug).toHaveLength(FLEET_SLUG_MAX_LENGTH);
      expect(slug.endsWith('-2')).toBe(true);
    });

    it('gives up rather than looping for ever', async () => {
      isTakenByLiveScope.mockImplementation(() => Promise.resolve(true));

      await expect(
        service.generateUniqueSlug({
          ...fleetScope,
          name: 'Jupiter Force',
          isTakenByLiveScope,
        }),
      ).rejects.toThrow(
        `Unable to find a free slug for 'jupiter-force' after ${MAX_FLEET_SLUG_ATTEMPTS} attempts`,
      );
      expect(isTakenByLiveScope).toHaveBeenCalledTimes(MAX_FLEET_SLUG_ATTEMPTS);

      isTakenByLiveScope.mockImplementation((slug: string) =>
        Promise.resolve(live.includes(slug)),
      );
    });
  });

  describe('recordRetiredSlug', () => {
    it('records the slug a Fleet stopped using, with its scope', async () => {
      await service.recordRetiredSlug(
        fleetScope,
        targetId,
        'old-name',
        'new-name',
      );

      expect(historyRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          targetType: FleetScopeKind.FLEET,
          targetId,
          communityId,
          platformId,
          slug: 'old-name',
        }),
      );
    });

    it('records a Community slug with no parent at all', async () => {
      await service.recordRetiredSlug(
        communityScope,
        targetId,
        'old-name',
        'new-name',
      );

      expect(historyRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ communityId: null, platformId: null }),
      );
    });

    it('does nothing when the slug has not changed', async () => {
      await service.recordRetiredSlug(fleetScope, targetId, 'same', 'same');

      expect(historyRepository.findOne).not.toHaveBeenCalled();
      expect(historyRepository.save).not.toHaveBeenCalled();
    });

    /**
     * A scope can retire a name, reclaim it and retire it again. The history
     * only needs to know the name was once in use, and the unique index would
     * refuse the second row in any case.
     */
    it('does not record the same retirement twice', async () => {
      retired = [{ slug: 'old-name', targetId }];

      await service.recordRetiredSlug(
        fleetScope,
        targetId,
        'old-name',
        'new-name',
      );

      expect(historyRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('findByRetiredSlug', () => {
    it('answers with the scope that used to hold the slug', async () => {
      retired = [{ slug: 'old-name', targetId }];

      await expect(
        service.findByRetiredSlug(fleetScope, 'old-name'),
      ).resolves.toBe(targetId);
    });

    it('answers null when the slug was never used', async () => {
      await expect(
        service.findByRetiredSlug(fleetScope, 'never-used'),
      ).resolves.toBeNull();
    });

    /**
     * The parents are matched as SQL NULL rather than as JavaScript null.
     * TypeORM turns a plain null in a `where` into `= NULL`, which matches
     * nothing at all, so a Community's own retired slug would never be found.
     */
    it('looks for a Community slug with no parent using IS NULL', async () => {
      await service.findByRetiredSlug(communityScope, 'old-name');

      expect(historyRepository.findOne).toHaveBeenCalledWith({
        where: {
          targetType: FleetScopeKind.COMMUNITY,
          communityId: IsNull(),
          platformId: IsNull(),
          slug: 'old-name',
        },
        order: { replacedAt: 'DESC' },
      });
    });

    it('looks for a Fleet slug inside its Community and platform', async () => {
      await service.findByRetiredSlug(fleetScope, 'old-name');

      expect(historyRepository.findOne).toHaveBeenCalledWith({
        where: {
          targetType: FleetScopeKind.FLEET,
          communityId,
          platformId,
          slug: 'old-name',
        },
        order: { replacedAt: 'DESC' },
      });
    });
  });
  describe('the reserved standalone segment', () => {
    /**
     * `standalone` stands where a Community's slug would sit, for a Fleet
     * that has none. A Community holding that slug would make one address
     * name two things.
     */
    it('refuses it to a Community, suffixing as for any taken name', async () => {
      await expect(
        service.generateUniqueSlug({
          ...communityScope,
          name: 'Standalone',
          isTakenByLiveScope,
        }),
      ).resolves.toBe('standalone-2');
    });

    it('refuses it however the registrant asks for it', async () => {
      await expect(
        service.generateUniqueSlug({
          ...communityScope,
          desiredSlug: 'standalone',
          name: 'Something Else',
          isTakenByLiveScope,
        }),
      ).resolves.toBe('standalone-2');
    });

    /**
     * The segment sits in the Community's position, so a Fleet or an Armada
     * called "Standalone" keeps the slug it would have had.
     */
    it('leaves a Fleet called Standalone alone', async () => {
      await expect(
        service.generateUniqueSlug({
          ...fleetScope,
          name: 'Standalone',
          isTakenByLiveScope,
        }),
      ).resolves.toBe('standalone');
    });
  });
});
