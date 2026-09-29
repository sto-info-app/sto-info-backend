import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { DataSource } from 'typeorm';

import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from '../utilities/governance-scope.utility';
import { ScopeGovernanceLogService } from './scope-governance-log.service';
import { ScopeSuspensionService } from './scope-suspension.service';

const COMMUNITY_ID = '23000000-0000-4000-8000-000000000001';
const FLEET_ID = '23000000-0000-4000-8000-000000000002';
const ARMADA_ID = '23000000-0000-4000-8000-000000000003';
const ADMIN_ID = '23000000-0000-4000-8000-000000000004';

describe('ScopeSuspensionService', () => {
  let stored: { id: string; status: FleetScopeStatus } | null;
  let manager: { findOne: jest.Mock; update: jest.Mock };
  let bump: jest.Mock;
  let record: jest.Mock;
  let service: ScopeSuspensionService;

  beforeEach(() => {
    stored = { id: FLEET_ID, status: FleetScopeStatus.ACTIVE };
    manager = {
      findOne: jest.fn(() => Promise.resolve(stored)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    bump = jest.fn(() => Promise.resolve(2));
    record = jest.fn(() => Promise.resolve());
    service = new ScopeSuspensionService(
      {
        transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
          work(manager),
        ),
      } as unknown as DataSource,
      { bump } as unknown as FleetAuthorisationRevisionService,
      { record } as unknown as ScopeGovernanceLogService,
    );
  });

  it.each([
    [
      'a Community',
      communityScope(COMMUNITY_ID),
      FleetCommunityEntity,
      { id: COMMUNITY_ID },
      COMMUNITY_ID,
    ],
    [
      'a Fleet',
      fleetScope(COMMUNITY_ID, FLEET_ID),
      StoFleetEntity,
      { id: FLEET_ID, communityId: COMMUNITY_ID },
      FLEET_ID,
    ],
    [
      'an Armada',
      armadaScope(COMMUNITY_ID, ARMADA_ID),
      StoArmadaEntity,
      { id: ARMADA_ID, communityId: COMMUNITY_ID },
      ARMADA_ID,
    ],
  ])(
    'suspends %s, locked, logged as a site admin’s and advertised',
    async (_name, scope, entity, where, id) => {
      stored = { id, status: FleetScopeStatus.ACTIVE };

      await service.suspend(scope, ' Under review ', ADMIN_ID);

      expect(manager.findOne).toHaveBeenCalledWith(entity, {
        where,
        lock: { mode: 'pessimistic_write' },
      });
      expect(manager.update).toHaveBeenCalledWith(
        entity,
        { id },
        { status: FleetScopeStatus.SUSPENDED },
      );
      expect(record).toHaveBeenCalledWith(manager, {
        scope,
        action: ScopeGovernanceActionKind.SUSPENDED,
        actorUserId: ADMIN_ID,
        asSiteAdmin: true,
        reason: 'Under review',
      });
      expect(bump).toHaveBeenCalledWith(scope.kind, id, manager);
    },
  );

  it('reinstates a suspended scope', async () => {
    stored = { id: FLEET_ID, status: FleetScopeStatus.SUSPENDED };

    await service.reinstate(
      fleetScope(COMMUNITY_ID, FLEET_ID),
      'Done',
      ADMIN_ID,
    );

    expect(manager.update).toHaveBeenCalledWith(
      StoFleetEntity,
      { id: FLEET_ID },
      { status: FleetScopeStatus.ACTIVE },
    );
    expect(record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ action: ScopeGovernanceActionKind.REINSTATED }),
    );
    expect(bump).toHaveBeenCalledWith(FleetScopeKind.FLEET, FLEET_ID, manager);
  });

  it('changes nothing when it is already so', async () => {
    stored = { id: FLEET_ID, status: FleetScopeStatus.SUSPENDED };
    await service.suspend(
      fleetScope(COMMUNITY_ID, FLEET_ID),
      'Again',
      ADMIN_ID,
    );

    stored = { id: FLEET_ID, status: FleetScopeStatus.ACTIVE };
    await service.reinstate(
      fleetScope(COMMUNITY_ID, FLEET_ID),
      'Again',
      ADMIN_ID,
    );

    expect(manager.update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('refuses a closed scope', async () => {
    stored = { id: FLEET_ID, status: FleetScopeStatus.CLOSED };

    await expect(
      service.suspend(fleetScope(COMMUNITY_ID, FLEET_ID), 'Why', ADMIN_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.reinstate(fleetScope(COMMUNITY_ID, FLEET_ID), 'Why', ADMIN_ID),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a scope that does not exist, and a missing reason', async () => {
    stored = null;

    await expect(
      service.suspend(fleetScope(COMMUNITY_ID, FLEET_ID), 'Why', ADMIN_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.suspend(fleetScope(COMMUNITY_ID, FLEET_ID), '  ', ADMIN_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reinstate(
        fleetScope(COMMUNITY_ID, FLEET_ID),
        undefined,
        ADMIN_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
