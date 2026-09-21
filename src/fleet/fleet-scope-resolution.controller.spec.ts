import { NotFoundException } from '@nestjs/common';

import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { FleetAudienceService } from './authorisation/fleet-audience.service';
import { FleetCommunityEntity } from './entities/fleet-community.entity';
import { StoFleetEntity } from './entities/sto-fleet.entity';
import { FleetAudience } from './enums/fleet-audience.enum';
import { FleetScopeKind } from './enums/fleet-scope-kind.enum';
import { FleetFeatureService } from './fleet-feature.service';
import { FleetScopeResolutionController } from './fleet-scope-resolution.controller';
import { StoFleetMapper } from './mappers/sto-fleet.mapper';
import { FleetCommunityService } from './services/fleet-community.service';
import { FleetPlatformService } from './services/fleet-platform.service';
import { StoFleetService } from './services/sto-fleet.service';

const COMMUNITY_ID = '20000000-0000-4000-8000-000000000001';
const FLEET_ID = '20000000-0000-4000-8000-000000000002';
const PLATFORM_ID = '20000000-0000-4000-8000-000000000003';
const USER_ID = '20000000-0000-4000-8000-000000000004';

const COMMUNITY = {
  id: COMMUNITY_ID,
  slug: 'jupiter-force',
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

describe('FleetScopeResolutionController', () => {
  let controller: FleetScopeResolutionController;
  let communityService: { resolveBySlugOrFail: jest.Mock };
  let platformService: { findBySegmentOrFail: jest.Mock };
  let fleetService: { resolveBySlugOrFail: jest.Mock };
  let audienceService: { assertCanView: jest.Mock };
  let featureService: { assertEnabled: jest.Mock };
  let fleetMapper: { toDto: jest.Mock };

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
    };

    audienceService = { assertCanView: jest.fn(() => Promise.resolve()) };
    featureService = { assertEnabled: jest.fn(() => Promise.resolve()) };
    fleetMapper = { toDto: jest.fn((fleet: StoFleetEntity) => fleet) };

    controller = new FleetScopeResolutionController(
      communityService as unknown as FleetCommunityService,
      platformService as unknown as FleetPlatformService,
      fleetService as unknown as StoFleetService,
      audienceService as unknown as FleetAudienceService,
      featureService as unknown as FleetFeatureService,
      fleetMapper as unknown as StoFleetMapper,
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
});
