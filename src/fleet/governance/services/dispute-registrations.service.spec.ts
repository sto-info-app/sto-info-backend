import { beforeEach, describe, expect, it } from '@jest/globals';

import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { InMemoryManager } from '../../../../test/in-memory-manager';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { DisputeRegistrationsService } from './dispute-registrations.service';

const ACTIVE = FleetScopeStatus.ACTIVE;
const WINDOWS = { name: 'Windows' };

describe('DisputeRegistrationsService', () => {
  let db: InMemoryManager;
  let service: DisputeRegistrationsService;

  /**
   * A Fleet or Armada row.
   *
   * @param overrides - What differs.
   * @returns The row.
   */
  const scopeRow = (overrides: Record<string, unknown>) => ({
    platformId: 'windows',
    platform: WINDOWS,
    exactGameName: 'Deep Space Nine',
    exactGameNameNormalized: 'deep space nine',
    status: ACTIVE,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    db = new InMemoryManager()
      .seed(FleetCommunityEntity, [
        {
          id: 'disputed',
          name: 'Disputed Community',
          ownerUserId: 'owner-1',
          visibility: FleetAudience.PUBLIC,
        },
        {
          id: 'rival',
          name: 'Rival Community',
          ownerUserId: 'owner-2',
          visibility: FleetAudience.PRIVATE,
        },
      ])
      .seed(UserProfileEntity, [{ userId: 'owner-1', username: 'Sisko' }])
      .seed(StoFleetEntity, [
        scopeRow({
          id: 'mine',
          communityId: 'disputed',
          visibility: FleetAudience.PUBLIC,
          lastEffectiveImportAt: new Date('2026-09-01T00:00:00Z'),
        }),
        scopeRow({
          id: 'theirs',
          communityId: 'rival',
          visibility: FleetAudience.PRIVATE,
          lastEffectiveImportAt: null,
          createdAt: new Date('2026-02-01T00:00:00Z'),
        }),
        scopeRow({
          id: 'unregistered',
          communityId: null,
          visibility: FleetAudience.PUBLIC,
          lastEffectiveImportAt: null,
        }),
        scopeRow({ id: 'gone', communityId: 'rival', deletedAt: new Date() }),
        scopeRow({
          id: 'console',
          communityId: 'rival',
          platformId: 'xbox',
          platform: { name: 'Xbox' },
        }),
      ])
      .seed(StoArmadaEntity, [
        scopeRow({
          id: 'armada',
          communityId: 'disputed',
          exactGameName: 'Alpha',
        }),
        scopeRow({
          id: 'rival-armada',
          communityId: 'rival',
          exactGameName: 'ALPHA',
          exactGameNameNormalized: 'alpha',
        }),
      ])
      .seed(ScopeMembershipEntity, [
        {
          fleetId: 'mine',
          status: ScopeMembershipStatus.APPROVED,
          deletedAt: null,
        },
        {
          fleetId: 'mine',
          status: ScopeMembershipStatus.APPROVED,
          deletedAt: null,
        },
        {
          fleetId: 'mine',
          status: ScopeMembershipStatus.LEFT,
          deletedAt: null,
        },
      ]);
    // The Armada rows share a name normalised on seeding, so fix it here.
    db.rows(StoArmadaEntity)[0].exactGameNameNormalized = 'alpha';
    service = new DisputeRegistrationsService(db.asDataSource());
  });

  it('lists each Fleet, then each Armada, with every other registration of its name', async () => {
    const [fleet, armada] = await service.scopesOf('disputed');

    expect(fleet).toEqual(
      expect.objectContaining({
        kind: FleetScopeKind.FLEET,
        id: 'mine',
        platformName: 'Windows',
        communityName: 'Disputed Community',
        communityOwner: { userId: 'owner-1', username: 'Sisko' },
        visibility: FleetAudience.PUBLIC,
        status: ACTIVE,
        lastImportAt: new Date('2026-09-01T00:00:00Z'),
        memberCount: 2,
      }),
    );
    expect(fleet.duplicates.map(each => each.id).sort()).toEqual([
      'theirs',
      'unregistered',
    ]);
    expect(fleet.duplicates.find(each => each.id === 'theirs')).toEqual(
      expect.objectContaining({
        communityName: 'Rival Community',
        communityOwner: { userId: 'owner-2', username: null },
        visibility: FleetAudience.PRIVATE,
        memberCount: 0,
      }),
    );
    expect(fleet.duplicates.find(each => each.id === 'unregistered')).toEqual(
      expect.objectContaining({
        communityId: null,
        communityName: null,
        communityOwner: null,
      }),
    );
    expect(armada).toEqual(
      expect.objectContaining({
        kind: FleetScopeKind.ARMADA,
        id: 'armada',
        visibility: FleetAudience.PUBLIC,
        lastImportAt: null,
        memberCount: null,
      }),
    );
    expect(armada.duplicates).toEqual([
      expect.objectContaining({
        id: 'rival-armada',
        visibility: FleetAudience.PRIVATE,
      }),
    ]);
  });

  it('names no Owner for a closed Community whose Owner was erased (FC-038)', async () => {
    db.rows(FleetCommunityEntity)[1].ownerUserId = null;

    const [fleet] = await service.scopesOf('disputed');

    expect(fleet.duplicates.find(each => each.id === 'theirs')).toEqual(
      expect.objectContaining({
        communityName: 'Rival Community',
        communityOwner: null,
      }),
    );
  });

  it('lists nothing for a Community with nothing in it', async () => {
    await expect(service.scopesOf('rival-none')).resolves.toEqual([]);
  });

  it('names nobody and nothing for a lone unregistered Fleet', async () => {
    db.rows(StoFleetEntity).splice(0);
    db.seed(StoFleetEntity, [
      scopeRow({ id: 'orphan', communityId: 'lonely', visibility: null }),
    ]);

    const [only] = await service.scopesOf('lonely');

    expect(only).toEqual(
      expect.objectContaining({
        communityName: null,
        visibility: null,
        duplicates: [],
      }),
    );
  });
});
