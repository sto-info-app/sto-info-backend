import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager } from 'typeorm';

import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import {
  GovernanceScope,
  requireReason,
  scopeIdOf,
} from '../utilities/governance-scope.utility';
import { ScopeGovernanceLogService } from './scope-governance-log.service';

/** A Community, Fleet or Armada row, as far as its status goes. */
type ScopeRow = FleetCommunityEntity | StoFleetEntity | StoArmadaEntity;

/** The table each kind of scope lives in. */
const ENTITY_OF = {
  [FleetScopeKind.COMMUNITY]: FleetCommunityEntity,
  [FleetScopeKind.FLEET]: StoFleetEntity,
  [FleetScopeKind.ARMADA]: StoArmadaEntity,
} as const;

/**
 * A site admin's suspension of a Community, Fleet or Armada (FC-036).
 *
 * Steve's decision of 29 September 2026: a suspended scope is read-only —
 * the resolver withdraws every mutating capability there, as it does at a
 * closed one, so nothing changes and nobody posts in its chat — until a
 * site admin reinstates it. A Community's suspension reaches its Fleets and
 * Armadas. Both need a reason, and both are logged as a site admin's.
 *
 * Unlike closure it ends nothing: roles, grants, memberships and events all
 * stand, and come back into force when it is reinstated. A closed scope is
 * never suspended or reinstated.
 */
@Injectable()
export class ScopeSuspensionService {
  private readonly _logger = new Logger(ScopeSuspensionService.name);

  /**
   * Creates an instance of ScopeSuspensionService.
   *
   * @param _dataSource - The database.
   * @param _revisionService - Advertises changes to access.
   * @param _log - Records the change.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _revisionService: FleetAuthorisationRevisionService,
    private readonly _log: ScopeGovernanceLogService,
  ) {}

  /**
   * Suspends a scope. Suspending a suspended one changes nothing.
   *
   * @param scope - The scope.
   * @param reason - Why.
   * @param actorUserId - The site admin.
   * @throws BadRequestException when no reason is given.
   * @throws NotFoundException when there is no such scope.
   * @throws ConflictException when it is closed.
   */
  async suspend(
    scope: GovernanceScope,
    reason: string | undefined,
    actorUserId: string,
  ): Promise<void> {
    await this.move(scope, {
      from: FleetScopeStatus.ACTIVE,
      to: FleetScopeStatus.SUSPENDED,
      action: ScopeGovernanceActionKind.SUSPENDED,
      reason: requireReason(reason, 'Say why it is being suspended.'),
      actorUserId,
    });
  }

  /**
   * Lifts a scope's suspension. Reinstating an active one changes nothing.
   *
   * @param scope - The scope.
   * @param reason - Why.
   * @param actorUserId - The site admin.
   * @throws BadRequestException when no reason is given.
   * @throws NotFoundException when there is no such scope.
   * @throws ConflictException when it is closed.
   */
  async reinstate(
    scope: GovernanceScope,
    reason: string | undefined,
    actorUserId: string,
  ): Promise<void> {
    await this.move(scope, {
      from: FleetScopeStatus.SUSPENDED,
      to: FleetScopeStatus.ACTIVE,
      action: ScopeGovernanceActionKind.REINSTATED,
      reason: requireReason(reason, 'Say why it is being reinstated.'),
      actorUserId,
    });
  }

  /**
   * Moves a scope from one status to another, logged and advertised.
   *
   * @param scope - The scope.
   * @param move - From what, to what, and who and why.
   * @param move.from - The status it must be in to move.
   * @param move.to - The status it moves to.
   * @param move.action - What the log calls it.
   * @param move.reason - Why.
   * @param move.actorUserId - The site admin.
   */
  private async move(
    scope: GovernanceScope,
    move: {
      readonly from: FleetScopeStatus;
      readonly to: FleetScopeStatus;
      readonly action: ScopeGovernanceActionKind;
      readonly reason: string;
      readonly actorUserId: string;
    },
  ): Promise<void> {
    const id = scopeIdOf(scope);
    const moved = await this._dataSource.transaction(async manager => {
      const row = await lock(manager, scope);

      if (row.status === move.to) {
        return false;
      }

      if (row.status !== move.from) {
        throw new ConflictException('It is closed, so it cannot change.');
      }

      await manager.update(
        ENTITY_OF[scope.kind],
        { id: row.id },
        { status: move.to },
      );
      await this._log.record(manager, {
        scope,
        action: move.action,
        actorUserId: move.actorUserId,
        asSiteAdmin: true,
        reason: move.reason,
      });
      await this._revisionService.bump(scope.kind, id, manager);

      return true;
    });

    if (moved) {
      this._logger.log(
        `[move] Scope status changed - Kind: ${scope.kind}, Id: ${id}, ` +
          `Status: ${move.to}`,
      );
    }
  }
}

/**
 * Finds a scope's row in its Community, locked.
 *
 * @param manager - The transaction.
 * @param scope - The scope.
 * @returns Its row.
 * @throws NotFoundException when there is none.
 */
async function lock(
  manager: EntityManager,
  scope: GovernanceScope,
): Promise<ScopeRow> {
  const row = await manager.findOne<ScopeRow>(ENTITY_OF[scope.kind], {
    where:
      scope.kind === FleetScopeKind.COMMUNITY
        ? { id: scope.communityId }
        : { id: scopeIdOf(scope), communityId: scope.communityId },
    lock: { mode: 'pessimistic_write' },
  });

  if (row === null) {
    throw new NotFoundException('Not found');
  }

  return row;
}
