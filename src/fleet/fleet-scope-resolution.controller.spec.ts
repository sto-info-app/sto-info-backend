import { NotFoundException } from '@nestjs/common';

import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { FleetAudienceService } from './authorisation/fleet-audience.service';
import { FleetCommunityEntity } from './entities/fleet-community.entity';
import { StoArmadaEntity } from './entities/sto-armada.entity';
import { StoFleetEntity } from './entities/sto-fleet.entity';
import { FleetAudience } from './enums/fleet-audience.enum';
import { FleetScopeKind } from './enums/fleet-scope-kind.enum';
import { FleetFeatureService } from './fleet-feature.service';
import { FleetScopeResolutionController } from './fleet-scope-resolution.controller';
import { StoArmadaMapper } from './mappers/sto-armada.mapper';
import { StoFleetMapper } from './mappers/sto-fleet.mapper';
import { FleetCommunityService } from './services/fleet-community.service';
import { FleetPlatformService } from './services/fleet-platform.service';
import { StoArmadaService } from './services/sto-armada.service';
import { StoFleetService } from './services/sto-fleet.service';

const COMMUNITY_ID = '20000000-0000-4000-8000-000000000001';
const FLEET_ID = '20000000-0000-4000-8000-000000000002';
const PLATFORM_ID = '20000000-0000-4000-8000-000000000003';
const USER_ID = '20000000-0000-4000-8000-000000000004';

const COMMUNITY = {
  id: COMMUNITY_ID,
  slug: 'jupiter-force',
  name: 'Jupiter Force',
  visibility: FleetAudience.PUBLIC,
} as FleetCommunityEntity;

const PLATFORM = { id: PLATFORM_ID, name: 'Windows' } as PlatformEntity;

const FLEET = {
  id: FLEET_ID,
  communityId: COMMUNITY_ID,
  platformId: PLATFORM_ID,
  slug: 'omega-command',
  visibility: FleetAudience.PUBLIC,
} as StoFleetEntity;

const STANDALONE_FLEET_ID = '20000000-0000-4000-8000-000000000006';

const STANDALONE_FLEET = {
  id: STANDALONE_FLEET_ID,
  communityId: null,
  platformId: PLATFORM_ID,
  slug: 'omega-command',
  visibility: FleetAudience.PUBLIC,
} as StoFleetEntity;

const ARMADA_ID = '20000000-0000-4000-8000-000000000005';

const ARMADA = {
  id: ARMADA_ID,
  communityId: COMMUNITY_ID,
  platformId: PLATFORM_ID,
  slug: 'sol-armada',
} as StoArmadaEntity;

describe('FleetScopeResolutionController', () => {
  let controller: FleetScopeResolutionController;
  let communityService: { resolveBySlugOrFail: jest.Mock };
  let platformService: { findBySegmentOrFail: jest.Mock };
  let fleetService: {
    resolveBySlugOrFail: jest.Mock;
    resolveStandaloneBySlugOrFail: jest.Mock;
  };
  let armadaService: { resolveBySlugOrFail: jest.Mock };
  let audienceService: { assertCanView: jest.Mock };
  let featureService: { assertEnabled: jest.Mock };
  let fleetMapper: { toDto: jest.Mock };
  let armadaMapper: { toDto: jest.Mock };

  beforeEach(() => {
    communityService = {
      resolveBySlugOrFail: jest.fn(() =>
        Promise.resolve({ community: COMMUNITY, redirectedFrom: null }),
      ),
    };

    platformService = {
      findBySegmentOrFail: jest.fn(() => Promise.resolve(PLATFORM)),
    };

    fleetService = {
      resolveBySlugOrFail: jest.fn(() =>
        Promise.resolve({ fleet: FLEET, redirected: false }),
      ),
      resolveStandaloneBySlugOrFail: jest.fn(() =>
        Promise.resolve(STANDALONE_FLEET),
      ),
    };

    armadaService = {
      resolveBySlugOrFail: jest.fn(() =>
        Promise.resolve({ armada: ARMADA, redirected: false }),
      ),
    };

    audienceService = { assertCanView: jest.fn(() => Promise.resolve()) };
    featureService = { assertEnabled: jest.fn(() => Promise.resolve()) };
    fleetMapper = { toDto: jest.fn((fleet: StoFleetEntity) => fleet) };
    armadaMapper = { toDto: jest.fn((armada: StoArmadaEntity) => armada) };

    controller = new FleetScopeResolutionController(
      communityService as unknown as FleetCommunityService,
      platformService as unknown as FleetPlatformService,
      fleetService as unknown as StoFleetService,
      armadaService as unknown as StoArmadaService,
      audienceService as unknown as FleetAudienceService,
      featureService as unknown as FleetFeatureService,
      fleetMapper as unknown as StoFleetMapper,
      armadaMapper as unknown as StoArmadaMapper,
    );
  });

  const resolve = (
    communitySlug = 'jupiter-force',
    platformSegment = 'windows',
    fleetSlug = 'omega-command',
    userId: string | null = USER_ID,
  ) =>
    controller.resolveFleet(communitySlug, platformSegment, fleetSlug, userId);

  it('resolves the whole address in one call', async () => {
    await expect(resolve()).resolves.toEqual({
      fleet: FLEET,
      communitySlug: 'jupiter-force',
      // The name as well as the segment. A page showing a Fleet names the
      // Community holding it, and "Held by jupiter-force" is a URL read
      // aloud rather than a name.
      communityName: 'Jupiter Force',
      platformSegment: 'windows',
      redirected: false,
    });
  });

  /**
   * Each segment is resolved against the one above it, so a Fleet addressed
   * under a Community that does not hold it is absent rather than redirected
   * somewhere plausible.
   */
  it('looks the Fleet up inside the Community the address names', async () => {
    await resolve();

    expect(fleetService.resolveBySlugOrFail).toHaveBeenCalledWith(
      COMMUNITY_ID,
      PLATFORM_ID,
      'omega-command',
    );
  });

  it('checks that the caller may see the Community and the Fleet', async () => {
    await resolve();

    expect(audienceService.assertCanView).toHaveBeenCalledWith(
      FleetAudience.PUBLIC,
      { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
      USER_ID,
    );
    expect(audienceService.assertCanView).toHaveBeenCalledWith(
      FleetAudience.PUBLIC,
      { kind: FleetScopeKind.FLEET, id: FLEET_ID },
      USER_ID,
    );
  });

  /**
   * A Community the caller may not see stops the resolution there, before
   * anything inside it is read. Answering a question about a Fleet in a
   * Community they cannot see would confirm the Community exists.
   */
  it('stops at the Community when the caller may not see it', async () => {
    audienceService.assertCanView.mockRejectedValueOnce(
      new NotFoundException('Not found'),
    );

    await expect(resolve()).rejects.toBeInstanceOf(NotFoundException);
    expect(fleetService.resolveBySlugOrFail).not.toHaveBeenCalled();
  });

  describe('when an address is out of date', () => {
    /**
     * ADR-0022: a `200` carrying the current segments rather than a `301`.
     * The caller has to replace its own history entry, and a transparent
     * redirect would have been followed before it could see it.
     */
    it('reports a renamed Fleet without redirecting', async () => {
      fleetService.resolveBySlugOrFail.mockResolvedValue({
        fleet: FLEET,
        redirected: true,
      });

      const resolved = await resolve('jupiter-force', 'windows', 'omega');

      expect(resolved.redirected).toBe(true);
      expect(resolved.fleet).toBe(FLEET);
    });

    it('reports a renamed Community', async () => {
      communityService.resolveBySlugOrFail.mockResolvedValue({
        community: COMMUNITY,
        redirectedFrom: 'jupiter',
      });

      await expect((await resolve('jupiter')).redirected).toBe(true);
    });

    /**
     * Every address the site writes is lowercase. A capitalised one still
     * resolves, and the caller is told to replace it, so one Fleet does not
     * end up with two addresses in circulation.
     */
    it('reports a capitalised platform segment as no longer canonical', async () => {
      const resolved = await resolve('jupiter-force', 'Windows');

      expect(resolved.redirected).toBe(true);
      expect(resolved.platformSegment).toBe('windows');
    });
  });

  it('refuses to resolve anything while the feature is switched off', async () => {
    featureService.assertEnabled.mockRejectedValue(
      new NotFoundException('Not found'),
    );

    await expect(resolve()).rejects.toBeInstanceOf(NotFoundException);
    expect(communityService.resolveBySlugOrFail).not.toHaveBeenCalled();
  });

  /**
   * A Fleet with no Community is addressed under the reserved word
   * `standalone` where a Community's slug would sit. The slug service
   * refuses that word to Communities, so the segment can only mean one
   * thing, and one route keeps resolving every Fleet address the site
   * writes.
   */
  describe('a standalone address', () => {
    const resolveStandalone = (
      platformSegment = 'windows',
      fleetSlug = 'omega-command',
      userId: string | null = USER_ID,
    ) =>
      controller.resolveFleet('standalone', platformSegment, fleetSlug, userId);

    it('resolves the Fleet without looking for a Community', async () => {
      await expect(resolveStandalone()).resolves.toEqual({
        fleet: STANDALONE_FLEET,
        communitySlug: 'standalone',
        // Nothing to name. The segment above still has a value, because the
        // address has that position filled by the word standing for its
        // absence.
        communityName: null,
        platformSegment: 'windows',
        redirected: false,
      });
      expect(communityService.resolveBySlugOrFail).not.toHaveBeenCalled();
    });

    it('looks the Fleet up among the standalone records on that platform', async () => {
      await resolveStandalone();

      expect(fleetService.resolveStandaloneBySlugOrFail).toHaveBeenCalledWith(
        PLATFORM_ID,
        'omega-command',
      );
    });

    it('still asks whether the caller may see it', async () => {
      await resolveStandalone();

      expect(audienceService.assertCanView).toHaveBeenCalledWith(
        FleetAudience.PUBLIC,
        { kind: FleetScopeKind.FLEET, id: STANDALONE_FLEET_ID },
        USER_ID,
      );
    });

    /**
     * Nothing can rename a standalone Fleet, so the platform is the only
     * segment of its address that can fall out of date.
     */
    it('reports a capitalised platform segment as no longer canonical', async () => {
      const resolved = await resolveStandalone('Windows');

      expect(resolved.redirected).toBe(true);
      expect(resolved.platformSegment).toBe('windows');
    });

    it('answers absent when nothing standalone holds the segment', async () => {
      fleetService.resolveStandaloneBySlugOrFail.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(resolveStandalone()).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses to resolve while the feature is switched off', async () => {
      featureService.assertEnabled.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(resolveStandalone()).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(fleetService.resolveStandaloneBySlugOrFail).not.toHaveBeenCalled();
    });

    /**
     * An Armada always has a Community, so `standalone` names no Community
     * and the address cannot exist.
     */
    it('means nothing on an Armada address', async () => {
      communityService.resolveBySlugOrFail.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        controller.resolveArmada(
          'standalone',
          'windows',
          'sol-armada',
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveArmada', () => {
    const resolveArmada = (
      communitySlug = 'jupiter-force',
      platformSegment = 'windows',
      armadaSlug = 'sol-armada',
      userId: string | null = USER_ID,
    ) =>
      controller.resolveArmada(
        communitySlug,
        platformSegment,
        armadaSlug,
        userId,
      );

    it('resolves the whole address in one call', async () => {
      await expect(resolveArmada()).resolves.toEqual({
        armada: ARMADA,
        communitySlug: 'jupiter-force',
        communityName: 'Jupiter Force',
        platformSegment: 'windows',
        redirected: false,
      });
    });

    it('looks the Armada up inside the Community the address names', async () => {
      await resolveArmada();

      expect(armadaService.resolveBySlugOrFail).toHaveBeenCalledWith(
        COMMUNITY_ID,
        PLATFORM_ID,
        'sol-armada',
      );
    });

    /**
     * One audience check, not two. An Armada carries no audience of its own,
     * so being allowed to see the Community is the whole of the question,
     * and a second check against a value that does not exist would either
     * read undefined or invent one.
     */
    it('asks only whether the caller may see the Community', async () => {
      await resolveArmada();

      expect(audienceService.assertCanView).toHaveBeenCalledTimes(1);
      expect(audienceService.assertCanView).toHaveBeenCalledWith(
        FleetAudience.PUBLIC,
        { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
        USER_ID,
      );
    });

    it('stops at the Community when the caller may not see it', async () => {
      audienceService.assertCanView.mockRejectedValueOnce(
        new NotFoundException('Not found'),
      );

      await expect(resolveArmada()).rejects.toBeInstanceOf(NotFoundException);
      expect(armadaService.resolveBySlugOrFail).not.toHaveBeenCalled();
    });

    it('reports a renamed Armada without redirecting', async () => {
      armadaService.resolveBySlugOrFail.mockResolvedValue({
        armada: ARMADA,
        redirected: true,
      });

      expect((await resolveArmada()).redirected).toBe(true);
    });

    it('reports a renamed Community', async () => {
      communityService.resolveBySlugOrFail.mockResolvedValue({
        community: COMMUNITY,
        redirectedFrom: 'jupiter',
      });

      expect((await resolveArmada('jupiter')).redirected).toBe(true);
    });

    it('reports a capitalised platform segment as no longer canonical', async () => {
      const resolved = await resolveArmada('jupiter-force', 'Windows');

      expect(resolved.redirected).toBe(true);
      expect(resolved.platformSegment).toBe('windows');
    });

    it('refuses to resolve anything while the feature is switched off', async () => {
      featureService.assertEnabled.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(resolveArmada()).rejects.toBeInstanceOf(NotFoundException);
      expect(communityService.resolveBySlugOrFail).not.toHaveBeenCalled();
    });
  });
});
