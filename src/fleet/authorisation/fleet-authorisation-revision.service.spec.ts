import { Logger } from '@nestjs/common';

import { EntityManager } from 'typeorm';

import { createAuthorisationWorld } from '../../../test/fleet-authorisation-world';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';

describe('FleetAuthorisationRevisionService', () => {
  const COMMUNITY = 'community-1';
  const FLEET = 'fleet-1';
  const ARMADA = 'armada-1';

  /**
   * Builds a world with one Community, one Fleet and one Armada.
   *
   * @returns The wired services and rows.
   */
  const buildWorld = () =>
    createAuthorisationWorld({
      users: [{ id: 'user-1', isAccountDisabled: false }],
      communities: [
        {
          id: COMMUNITY,
          ownerUserId: 'user-1',
          status: FleetScopeStatus.ACTIVE,
          revision: 4,
        },
      ],
      fleets: [
        {
          id: FLEET,
          communityId: COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 7,
        },
      ],
      armadas: [
        {
          id: ARMADA,
          communityId: COMMUNITY,
          status: FleetScopeStatus.ACTIVE,
          revision: 2,
        },
      ],
    });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    [FleetScopeKind.COMMUNITY, COMMUNITY, 5],
    [FleetScopeKind.FLEET, FLEET, 8],
    [FleetScopeKind.ARMADA, ARMADA, 3],
  ])('advances a %s revision by one', async (kind, id, expected) => {
    const world = buildWorld();

    await expect(world.revision.bump(kind, id)).resolves.toBe(expected);
  });

  it('reports the new revision through the resolved scope', async () => {
    const world = buildWorld();

    await world.revision.bump(FleetScopeKind.FLEET, FLEET);

    const scope = await world.authorisation.resolveScope({
      kind: FleetScopeKind.FLEET,
      id: FLEET,
    });

    expect(scope?.revision).toBe(8);
  });

  it('leaves other scopes alone', async () => {
    const world = buildWorld();

    await world.revision.bump(FleetScopeKind.FLEET, FLEET);

    expect(world.rows.communities[0].revision).toBe(4);
    expect(world.rows.armadas[0].revision).toBe(2);
  });

  it('reports a scope that has gone rather than inventing a revision', async () => {
    const world = buildWorld();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(
      world.revision.bump(FleetScopeKind.FLEET, 'fleet-missing'),
    ).resolves.toBeNull();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('fleet-missing'),
    );
  });

  /**
   * A revision bump that is not part of the transaction making the change can
   * advertise a change that was rolled back. Passing the manager through is
   * what ties the two together, so the service has to use it when it is given.
   */
  it.each([
    [FleetScopeKind.COMMUNITY, COMMUNITY, FleetCommunityEntity],
    [FleetScopeKind.FLEET, FLEET, StoFleetEntity],
    [FleetScopeKind.ARMADA, ARMADA, StoArmadaEntity],
  ])('uses the open transaction for a %s', async (kind, id, entity) => {
    const world = buildWorld();
    const repository = {
      increment: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue({ id, revision: 99 }),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(repository),
    } as unknown as EntityManager;

    await expect(world.revision.bump(kind, id, manager)).resolves.toBe(99);
    expect(manager.getRepository).toHaveBeenCalledWith(entity);
    expect(repository.increment).toHaveBeenCalledWith({ id }, 'revision', 1);
  });

  /**
   * The memoisation exists so several checks in one request are cheap. It must
   * not make the request that changed somebody's access answer from before the
   * change.
   */
  it('forgets memoised answers about the scope it bumped', async () => {
    const world = createAuthorisationWorld(
      {
        users: [{ id: 'user-1', isAccountDisabled: false }],
        communities: [
          {
            id: COMMUNITY,
            ownerUserId: 'user-2',
            status: FleetScopeStatus.ACTIVE,
            revision: 1,
          },
        ],
        fleets: [
          {
            id: FLEET,
            communityId: COMMUNITY,
            status: FleetScopeStatus.ACTIVE,
            revision: 1,
          },
        ],
      },
      true,
    );
    const ref = { kind: FleetScopeKind.FLEET, id: FLEET };

    const before = await world.authorisation.authorise('user-1', ref);
    expect(before?.capabilities.size).toBe(0);

    world.rows.communities[0].ownerUserId = 'user-1';
    await world.revision.bump(FleetScopeKind.FLEET, FLEET);

    const after = await world.authorisation.authorise('user-1', ref);
    expect(after?.capabilities.size).toBeGreaterThan(0);
  });

  it('leaves memoised answers about other scopes in place', async () => {
    const world = createAuthorisationWorld(
      {
        users: [{ id: 'user-1', isAccountDisabled: false }],
        communities: [
          {
            id: COMMUNITY,
            ownerUserId: 'user-2',
            status: FleetScopeStatus.ACTIVE,
            revision: 1,
          },
        ],
        fleets: [
          {
            id: FLEET,
            communityId: COMMUNITY,
            status: FleetScopeStatus.ACTIVE,
            revision: 1,
          },
        ],
      },
      true,
    );

    await world.authorisation.authorise('user-1', {
      kind: FleetScopeKind.COMMUNITY,
      id: COMMUNITY,
    });

    world.rows.communities[0].ownerUserId = 'user-1';
    await world.revision.bump(FleetScopeKind.FLEET, FLEET);

    const stillCached = await world.authorisation.authorise('user-1', {
      kind: FleetScopeKind.COMMUNITY,
      id: COMMUNITY,
    });

    expect(stillCached?.capabilities.size).toBe(0);
  });

  it('does nothing about memoisation outside a request', async () => {
    const world = buildWorld();

    await expect(
      world.revision.bump(FleetScopeKind.FLEET, FLEET),
    ).resolves.toBe(8);
  });
});
