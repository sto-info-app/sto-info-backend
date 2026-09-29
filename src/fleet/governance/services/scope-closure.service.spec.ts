import { BadRequestException, NotFoundException } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { ArmadaJoinRequestEntity } from '../../armadas/entities/armada-join-request.entity';
import { ArmadaJoinRequestStatus } from '../../armadas/enums/armada-join-request-status.enum';
import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import {
  communityScope,
  fleetScope,
} from '../utilities/governance-scope.utility';
import { OwnershipTransferService } from './ownership-transfer.service';
import { ScopeClosureService } from './scope-closure.service';
import { ScopeGovernanceLogService } from './scope-governance-log.service';
import { ScopeRolesService } from './scope-roles.service';

const COMMUNITY_ID = '22000000-0000-4000-8000-000000000001';
const FLEET_ID = '22000000-0000-4000-8000-000000000002';
const OWNER_ID = '22000000-0000-4000-8000-000000000003';

describe('ScopeClosureService', () => {
  let stored: { status: FleetScopeStatus; closedAt: Date | null } | null;
  let manager: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let bump: jest.Mock;
  let record: jest.Mock;
  let endAllWithin: jest.Mock;
  let cancelOpenWithin: jest.Mock;
  let service: ScopeClosureService;

  beforeEach(() => {
    stored = { status: FleetScopeStatus.ACTIVE, closedAt: null };
    manager = {
      // No events to end.
      find: jest.fn(() => Promise.resolve([])),
      // A Fleet in no Armada: the placement read finds nothing.
      findOne: jest.fn((entity: unknown) =>
        Promise.resolve(entity === ArmadaFleetMembershipEntity ? null : stored),
      ),
      save: jest.fn((_entity: unknown, row: object) => Promise.resolve(row)),
      update: jest.fn(() => Promise.resolve({ affected: 0 })),
    };
    bump = jest.fn(() => Promise.resolve(2));
    record = jest.fn(() => Promise.resolve());
    endAllWithin = jest.fn(() => Promise.resolve());
    cancelOpenWithin = jest.fn(() => Promise.resolve());
    service = new ScopeClosureService(
      {
        transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
          work(manager),
        ),
      } as unknown as DataSource,
      { bump } as unknown as FleetAuthorisationRevisionService,
      { record } as unknown as ScopeGovernanceLogService,
      { endAllWithin } as unknown as ScopeRolesService,
      { cancelOpenWithin } as unknown as OwnershipTransferService,
    );
  });

  describe('closing a Community', () => {
    const close = (reason: string | undefined = '  Winding down  ') =>
      service.closeCommunity(COMMUNITY_ID, {
        reason,
        actorUserId: OWNER_ID,
      });

    it('requires a reason before touching anything', async () => {
      await expect(close('  ')).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.findOne).not.toHaveBeenCalled();
    });

    it('refuses a Community that does not exist', async () => {
      stored = null;

      await expect(close()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('locks the Community while it closes it', async () => {
      await close();

      expect(manager.findOne).toHaveBeenCalledWith(FleetCommunityEntity, {
        where: { id: COMMUNITY_ID },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('closes it, ends every role and grant there, and logs why', async () => {
      const closed = await close();
      const scope = communityScope(COMMUNITY_ID);

      expect(closed.status).toBe(FleetScopeStatus.CLOSED);
      expect(closed.closedAt).toBeInstanceOf(Date);
      expect(endAllWithin).toHaveBeenCalledWith(
        manager,
        scope,
        closed.closedAt,
      );
      // Its events, and every Fleet's and Armada's in it (FC-028).
      expect(manager.find).toHaveBeenCalledWith(ScopeEventEntity, {
        where: { communityId: COMMUNITY_ID, status: ScopeEventStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
      });
      expect(cancelOpenWithin).toHaveBeenCalledWith(manager, COMMUNITY_ID, {
        actorUserId: OWNER_ID,
        asSiteAdmin: undefined,
      });
      expect(record).toHaveBeenCalledWith(manager, {
        scope,
        action: ScopeGovernanceActionKind.CLOSED,
        actorUserId: OWNER_ID,
        asSiteAdmin: undefined,
        reason: 'Winding down',
      });
      expect(bump).toHaveBeenCalledWith(
        FleetScopeKind.COMMUNITY,
        COMMUNITY_ID,
        manager,
      );
    });

    it('records a site administrator’s closure as theirs', async () => {
      await service.closeCommunity(COMMUNITY_ID, {
        reason: 'Reported for abuse',
        actorUserId: OWNER_ID,
        asSiteAdmin: true,
      });

      expect(record).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ asSiteAdmin: true }),
      );
    });

    // A retry must not move the date the evidence says it closed.
    it('leaves a closed Community exactly as it was', async () => {
      const closedAt = new Date('2026-09-01T10:00:00.000Z');
      stored = { status: FleetScopeStatus.CLOSED, closedAt };

      await expect(close()).resolves.toEqual({
        status: FleetScopeStatus.CLOSED,
        closedAt,
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
      expect(bump).not.toHaveBeenCalled();
    });
  });

  describe('closing a Fleet', () => {
    const close = (reason: string | undefined = 'Merged into another') =>
      service.closeFleet(COMMUNITY_ID, FLEET_ID, {
        reason,
        actorUserId: OWNER_ID,
      });

    it('requires a reason', async () => {
      await expect(close('   ')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a Fleet the Community does not hold', async () => {
      stored = null;

      await expect(close()).rejects.toBeInstanceOf(NotFoundException);
      expect(manager.findOne).toHaveBeenCalledWith(StoFleetEntity, {
        where: { id: FLEET_ID, communityId: COMMUNITY_ID },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('closes it, ends every role and grant there, and logs why', async () => {
      const closed = await close();
      const scope = fleetScope(COMMUNITY_ID, FLEET_ID);

      expect(closed.status).toBe(FleetScopeStatus.CLOSED);
      expect(endAllWithin).toHaveBeenCalledWith(
        manager,
        scope,
        closed.closedAt,
      );
      // Its own events (FC-028).
      expect(manager.find).toHaveBeenCalledWith(ScopeEventEntity, {
        where: {
          communityId: COMMUNITY_ID,
          fleetId: FLEET_ID,
          status: ScopeEventStatus.ACTIVE,
        },
        lock: { mode: 'pessimistic_write' },
      });
      expect(cancelOpenWithin).not.toHaveBeenCalled();
      expect(record).toHaveBeenCalledWith(manager, {
        scope,
        action: ScopeGovernanceActionKind.CLOSED,
        actorUserId: OWNER_ID,
        reason: 'Merged into another',
      });
      expect(bump).toHaveBeenCalledWith(
        FleetScopeKind.FLEET,
        FLEET_ID,
        manager,
      );
    });

    // FC-024: a closed Fleet asks to join no Armada, and leaves its own.
    it('cancels the Fleet’s open Armada request, and ends any placement', async () => {
      await close();

      expect(manager.update).toHaveBeenCalledWith(
        ArmadaJoinRequestEntity,
        { fleetId: FLEET_ID, status: ArmadaJoinRequestStatus.PENDING },
        expect.objectContaining({
          status: ArmadaJoinRequestStatus.CANCELLED,
        }),
      );
      expect(manager.findOne).toHaveBeenCalledWith(
        ArmadaFleetMembershipEntity,
        expect.objectContaining({
          where: expect.objectContaining({ fleetId: FLEET_ID }),
        }),
      );
    });

    it('leaves a closed Fleet exactly as it was', async () => {
      stored = { status: FleetScopeStatus.CLOSED, closedAt: new Date() };

      await close();

      expect(manager.save).not.toHaveBeenCalled();
      expect(bump).not.toHaveBeenCalled();
    });
  });
});
