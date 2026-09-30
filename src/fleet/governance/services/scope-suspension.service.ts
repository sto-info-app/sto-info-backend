import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, IsNull } from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';

import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { scopePlaceOf } from '../../utilities/scope-place.utility';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import {
  atExactly,
  communityScope,
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

/** Whom a suspension or reinstatement is told to, and about what. */
interface SuspensionAudience {
  /** The scope's name. */
  readonly name: string;
  /** Its page, from the site's root. */
  readonly path: string;
  /** Its Owner and Admins, once each. */
  readonly userIds: readonly string[];
}

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
 *
 * Steve's decision of 30 September 2026: its Owner and Admins are told
 * in-app that it was suspended or reinstated, without the reason, and
 * nothing goes in its activity feed. Whom to tell is read in the same
 * transaction as the change; the notices go once it is committed, as the
 * Fleet's other governance notices do, and one that fails undoes nothing.
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
   * @param _notificationService - Tells its Owner and Admins.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _revisionService: FleetAuthorisationRevisionService,
    private readonly _log: ScopeGovernanceLogService,
    private readonly _notificationService: NotificationService,
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
   * Moves a scope from one status to another, logged and advertised, then
   * tells its Owner and Admins.
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
    const audience = await this._dataSource.transaction(async manager => {
      const row = await lock(manager, scope);

      if (row.status === move.to) {
        return null;
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

      return audienceOf(manager, scope, move.actorUserId);
    });

    if (audience === null) {
      return;
    }

    this._logger.log(
      `[move] Scope status changed - Kind: ${scope.kind}, Id: ${id}, ` +
        `Status: ${move.to}`,
    );
    await this.tell(scope, audience, move.to === FleetScopeStatus.SUSPENDED);
  }

  /**
   * Tells a scope's Owner and Admins it was suspended or reinstated, never
   * why, reporting rather than throwing when a notice cannot be written.
   *
   * @param scope - The scope.
   * @param audience - Whom, and its name and page.
   * @param suspended - True when it was suspended, false when reinstated.
   */
  private async tell(
    scope: GovernanceScope,
    audience: SuspensionAudience,
    suspended: boolean,
  ): Promise<void> {
    const { name } = audience;
    const frontendUrl = process.env.APP_FRONTEND_URL;
    const reach =
      scope.kind === FleetScopeKind.COMMUNITY
        ? ', and with it its Fleets and Armadas'
        : '';
    const notice = suspended
      ? {
          severity: NotificationSeverity.WARNING,
          title: `${name} was suspended`,
          body:
            `A site administrator suspended ${name}${reach}. Until it is ` +
            'reinstated, nothing there can be changed and nobody can post ' +
            'in its chat.',
        }
      : {
          severity: NotificationSeverity.SUCCESS,
          title: `${name} was reinstated`,
          body:
            `A site administrator lifted ${name}’s suspension. Its roles, ` +
            'members and events stand as they were.',
        };

    for (const userId of audience.userIds) {
      try {
        await this._notificationService.createNotification({
          target: NotificationTarget.USER,
          userId,
          ...notice,
          ...(frontendUrl ? { linkUrl: `${frontendUrl}${audience.path}` } : {}),
        });
      } catch (error) {
        this._logger.warn(
          `[tell] A suspension notice was not sent - UserId: ${userId}, ` +
            `Reason: ${(error as Error).name}`,
        );
      }
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

/**
 * Whom a suspension or reinstatement is told to: the Community's Owner and
 * the Admins at the scope — at a Fleet or Armada, the Community's Admins
 * too, whose role reaches it. Each once, and never the site admin who made
 * it.
 *
 * @param manager - The transaction.
 * @param scope - The scope, whose row is locked.
 * @param actorUserId - The site admin.
 * @returns Its name, its page and whom to tell.
 */
async function audienceOf(
  manager: EntityManager,
  scope: GovernanceScope,
  actorUserId: string,
): Promise<SuspensionAudience> {
  const place = await scopePlaceOf(manager, scope);
  const community = await manager.findOne(FleetCommunityEntity, {
    where: { id: scope.communityId },
    select: { id: true, ownerUserId: true },
  });
  const levels =
    scope.kind === FleetScopeKind.COMMUNITY
      ? [scope]
      : [scope, communityScope(scope.communityId)];
  const admins = await manager.find(ScopeRoleAssignmentEntity, {
    where: levels.map(level => ({
      ...atExactly<ScopeRoleAssignmentEntity>(level),
      role: FleetScopeRole.ADMIN,
      validTo: IsNull(),
    })),
    select: { id: true, userId: true },
  });
  const userIds = new Set(admins.map(admin => admin.userId));

  if (community?.ownerUserId) {
    userIds.add(community.ownerUserId);
  }

  userIds.delete(actorUserId);

  return {
    name: place?.name ?? '',
    path: place?.path ?? '',
    userIds: place === null ? [] : [...userIds],
  };
}
