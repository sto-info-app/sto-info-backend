import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { endFleetForClosure } from '../../armadas/utilities/armada-arrangement.utility';
import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { endEventsForClosure } from '../../events/utilities/event-closure.utility';
import { StoArmadaService } from '../../services/sto-armada.service';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import {
  armadaScope,
  communityScope,
  fleetScope,
  requireReason,
} from '../utilities/governance-scope.utility';
import { OwnershipTransferService } from './ownership-transfer.service';
import { ScopeGovernanceLogService } from './scope-governance-log.service';
import { ScopeRolesService } from './scope-roles.service';

/** Who is closing, and why. */
export interface ClosureRequest {
  /** Why. Required. */
  readonly reason: string | undefined;
  /** Who. */
  readonly actorUserId: string;
  /** Whether a site administrator is, in a dispute. */
  readonly asSiteAdmin?: boolean;
}

/**
 * Closes a Community or a Fleet (FC-022).
 *
 * Closure is a status change, never a deletion: the record, its web address,
 * its roster history and its Armada placements all stay, and the resolver
 * withdraws every mutating capability from a closed scope. Steve decided on
 * 27 September 2026 that it also ends every role and capability grant held at
 * the scope, whose rows keep their dates; memberships, recruitment, artwork
 * and the Fleets inside a Community are left as they are. A Community's open
 * ownership offer is cancelled with it.
 *
 * A reason is required, and the closure is logged. Closing what is closed
 * already succeeds and changes nothing, so a retry cannot move the date.
 */
@Injectable()
export class ScopeClosureService {
  private readonly _logger = new Logger(ScopeClosureService.name);

  /**
   * Creates an instance of ScopeClosureService.
   *
   * @param _dataSource - The database.
   * @param _revisionService - Advertises changes to access.
   * @param _log - Records the closure.
   * @param _roles - Ends the roles and grants held there.
   * @param _transfers - Cancels a Community's open ownership offer.
   * @param _armadas - Closes an Armada, for a site admin (FC-036).
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _revisionService: FleetAuthorisationRevisionService,
    private readonly _log: ScopeGovernanceLogService,
    private readonly _roles: ScopeRolesService,
    private readonly _transfers: OwnershipTransferService,
    private readonly _armadas: StoArmadaService,
  ) {}

  /**
   * Closes a Community.
   *
   * @param communityId - The Community.
   * @param request - Who, and why.
   * @returns The Community, closed.
   * @throws BadRequestException when no reason is given.
   * @throws NotFoundException when there is no such Community.
   */
  async closeCommunity(
    communityId: string,
    request: ClosureRequest,
  ): Promise<FleetCommunityEntity> {
    const reason = requireReason(request.reason, 'Say why it is being closed.');

    const closed = await this._dataSource.transaction(async manager => {
      const community = await manager.findOne(FleetCommunityEntity, {
        where: { id: communityId },
        lock: { mode: 'pessimistic_write' },
      });

      if (community === null) {
        throw new NotFoundException('Not found');
      }

      if (community.status === FleetScopeStatus.CLOSED) {
        return community;
      }

      const now = new Date();
      const scope = communityScope(communityId);

      community.status = FleetScopeStatus.CLOSED;
      community.closedAt = now;

      const saved = await manager.save(FleetCommunityEntity, community);

      await this._roles.endAllWithin(manager, scope, now);
      // Its events, and its Fleets' and Armadas', have nothing ahead of them
      // (FC-028).
      await endEventsForClosure(
        manager,
        { communityId, fleetId: null, armadaId: null },
        request.actorUserId,
        now,
      );
      await this._transfers.cancelOpenWithin(manager, communityId, {
        actorUserId: request.actorUserId,
        asSiteAdmin: request.asSiteAdmin,
      });
      await this._log.record(manager, {
        scope,
        action: ScopeGovernanceActionKind.CLOSED,
        actorUserId: request.actorUserId,
        asSiteAdmin: request.asSiteAdmin,
        reason,
      });
      // Closure withdraws every mutating capability at the Community and at
      // each Fleet and Armada inside it, so this one is not optional.
      await this._revisionService.bump(
        FleetScopeKind.COMMUNITY,
        communityId,
        manager,
      );

      return saved;
    });

    this._logger.log(
      `[closeCommunity] Community closed - CommunityId: ${communityId}`,
    );

    return closed;
  }

  /**
   * Closes a Fleet.
   *
   * @param communityId - The Community holding it.
   * @param fleetId - The Fleet.
   * @param request - Who, and why.
   * @returns The Fleet, closed.
   * @throws BadRequestException when no reason is given.
   * @throws NotFoundException when the Community holds no such Fleet.
   */
  async closeFleet(
    communityId: string,
    fleetId: string,
    request: ClosureRequest,
  ): Promise<StoFleetEntity> {
    const reason = requireReason(request.reason, 'Say why it is being closed.');

    const closed = await this._dataSource.transaction(async manager => {
      const fleet = await manager.findOne(StoFleetEntity, {
        where: { id: fleetId, communityId },
        lock: { mode: 'pessimistic_write' },
      });

      if (fleet === null) {
        throw new NotFoundException('Not found');
      }

      if (fleet.status === FleetScopeStatus.CLOSED) {
        return fleet;
      }

      const now = new Date();
      const scope = fleetScope(communityId, fleetId);

      fleet.status = FleetScopeStatus.CLOSED;
      fleet.closedAt = now;

      const saved = await manager.save(StoFleetEntity, fleet);

      await this._roles.endAllWithin(manager, scope, now);
      // A closed Fleet comes out of its Armada, and asks to join none
      // (FC-024).
      await endFleetForClosure(
        manager,
        { id: fleetId, exactGameName: saved.exactGameName },
        request.actorUserId,
        now,
      );
      await endEventsForClosure(
        manager,
        { communityId, fleetId, armadaId: null },
        request.actorUserId,
        now,
      );
      await this._log.record(manager, {
        scope,
        action: ScopeGovernanceActionKind.CLOSED,
        actorUserId: request.actorUserId,
        asSiteAdmin: request.asSiteAdmin,
        reason,
      });
      await this._revisionService.bump(FleetScopeKind.FLEET, fleetId, manager);

      return saved;
    });

    this._logger.log(`[closeFleet] Fleet closed - FleetId: ${fleetId}`);

    return closed;
  }

  /**
   * Closes an Armada, with a reason: by its Owner (FC-050) or by a site admin
   * in a dispute (FC-036). The Armada's own closure ends its placements and
   * the rest; this adds the governance entry, as a Community's and a Fleet's
   * closures have.
   *
   * @param communityId - The Community holding it.
   * @param armadaId - The Armada.
   * @param request - Who, and why.
   * @returns The Armada, closed.
   * @throws BadRequestException when no reason is given.
   * @throws NotFoundException when the Community holds no such Armada.
   */
  async closeArmada(
    communityId: string,
    armadaId: string,
    request: ClosureRequest,
  ): Promise<StoArmadaEntity> {
    const reason = requireReason(request.reason, 'Say why it is being closed.');

    return this._armadas.close(
      communityId,
      armadaId,
      request.actorUserId,
      (manager, closed) =>
        this._log.record(manager, {
          scope: armadaScope(communityId, closed.id),
          action: ScopeGovernanceActionKind.CLOSED,
          actorUserId: request.actorUserId,
          asSiteAdmin: request.asSiteAdmin === true,
          reason,
        }),
    );
  }
}
