import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';

import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { ScopeAuthorisation } from '../../authorisation/scope-authorisation.interface';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeCapabilityGrantEntity } from '../../entities/scope-capability-grant.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeCapabilityEffect } from '../../enums/scope-capability-effect.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import {
  AssignScopeRoleDto,
  GovernancePersonDto,
  ScopeRolesDto,
  SetOfficerCapabilitiesDto,
  SetPersonalCapabilityDto,
} from '../dto/scope-governance.dto';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import {
  atExactly,
  delegableAt,
  GovernanceScope,
  optionalReason,
  requireDelegable,
  requireReason,
  toScopeRef,
} from '../utilities/governance-scope.utility';
import { OwnershipTransferService } from './ownership-transfer.service';
import { ScopeGovernanceLogService } from './scope-governance-log.service';

/** The role labels an Owner gives and takes; Owner itself moves by transfer. */
const MANAGED_ROLES = [FleetScopeRole.ADMIN, FleetScopeRole.OFFICER];

/** What a role label is called in a refusal. */
const ROLE_NAMES: Record<FleetScopeRole, string> = {
  [FleetScopeRole.OWNER]: 'the Owner',
  [FleetScopeRole.ADMIN]: 'an Admin',
  [FleetScopeRole.OFFICER]: 'an Officer',
  [FleetScopeRole.MEMBER]: 'a Member',
};

/**
 * What a person is sorted by: their username, with the unnamed first.
 *
 * @param person - The person.
 * @returns The key.
 */
function sortName(person: GovernancePersonDto): string {
  return person.username ?? '';
}

/**
 * Role labels and delegated capabilities at a Community or Fleet (FC-022).
 *
 * With Steve's decisions of 27 September 2026:
 *
 * - Only the Owner changes any of this: `scope.roles.manage` is the Owner's
 *   and cannot be delegated. The route guard asks for it, so an Admin is
 *   refused before anything here runs.
 * - The Owner appoints Admins and Officers from the scope's approved
 *   members: a Fleet's own, or, at the Community, a member of any of its
 *   Fleets. One role per person per scope; changing it means withdrawing it
 *   first.
 * - The Owner sets what every Officer here holds, and grants or denies single
 *   capabilities to one person. A denial beats every grant and every role.
 * - A reason is required whenever something is taken away.
 *
 * Only the capabilities `delegableAt` names can be delegated, which is the
 * ceiling: a site-wide permission is not in this vocabulary at all, and the
 * powers that make somebody the Owner are not delegable. Every row is written
 * at the scope the route resolved, so nothing here can reach another scope.
 */
@Injectable()
export class ScopeRolesService {
  /**
   * Creates an instance of ScopeRolesService.
   *
   * @param _dataSource - The database.
   * @param _authorisation - Says what the reader holds here.
   * @param _revisionService - Advertises changes to access.
   * @param _log - Records each change.
   * @param _transfers - Cancels an offer to an Admin who loses the role.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _authorisation: FleetAuthorisationService,
    private readonly _revisionService: FleetAuthorisationRevisionService,
    private readonly _log: ScopeGovernanceLogService,
    private readonly _transfers: OwnershipTransferService,
  ) {}

  /**
   * Refuses anybody but the Owner and Admins here.
   *
   * @param scope - The scope.
   * @param userId - The reader.
   * @returns What the policy concluded about them.
   * @throws NotFoundException when the scope does not resolve for them.
   * @throws ForbiddenException when they are neither Owner nor Admin here.
   */
  async assertMayRead(
    scope: GovernanceScope,
    userId: string,
  ): Promise<ScopeAuthorisation> {
    const authorisation = await this._authorisation.authorise(
      userId,
      toScopeRef(scope),
    );

    if (authorisation === null) {
      throw new NotFoundException('Not found');
    }

    if (
      !authorisation.roles.has(FleetScopeRole.OWNER) &&
      !authorisation.roles.has(FleetScopeRole.ADMIN)
    ) {
      throw new ForbiddenException(
        'Only the Owner and Admins can read who governs this.',
      );
    }

    return authorisation;
  }

  /**
   * Describes who governs a scope, for its Owner and Admins.
   *
   * @param scope - The scope.
   * @param userId - The reader.
   * @returns The Owner, role holders, delegations and, for the Owner, whom
   *   they may appoint.
   * @throws NotFoundException when the scope does not resolve for them.
   * @throws ForbiddenException when they are neither Owner nor Admin here.
   */
  async view(scope: GovernanceScope, userId: string): Promise<ScopeRolesDto> {
    const authorisation = await this.assertMayRead(scope, userId);
    const mayManage = authorisation.capabilities.has(
      FLEET_CAPABILITIES.SCOPE_ROLES_MANAGE,
    );
    const manager = this._dataSource.manager;
    const ownerUserId = authorisation.scope.communityOwnerUserId;

    const [assignments, grants] = await Promise.all([
      manager.find(ScopeRoleAssignmentEntity, {
        where: {
          ...atExactly<ScopeRoleAssignmentEntity>(scope),
          role: In(MANAGED_ROLES),
          validTo: IsNull(),
        },
        order: { validFrom: 'ASC' },
      }),
      manager.find(ScopeCapabilityGrantEntity, {
        where: {
          ...atExactly<ScopeCapabilityGrantEntity>(scope),
          validTo: IsNull(),
        },
        order: { validFrom: 'ASC' },
      }),
    ]);

    const holderIds = new Set(assignments.map(row => row.userId));
    const candidateIds = mayManage
      ? (await this.eligible(manager, scope)).filter(
          id => id !== ownerUserId && !holderIds.has(id),
        )
      : [];
    const personal = grants.filter(grant => grant.subjectUserId !== null);
    const names = await usernamesFor(manager, [
      ownerUserId,
      ...holderIds,
      ...candidateIds,
      ...personal.map(grant => grant.subjectUserId),
    ]);
    const person = (id: string): GovernancePersonDto => ({
      userId: id,
      username: names.get(id) ?? null,
    });

    return {
      owner: person(ownerUserId),
      mayManage,
      holders: assignments.map(row => ({
        ...person(row.userId),
        assignmentId: row.id,
        role: row.role,
        since: row.validFrom,
      })),
      candidates: candidateIds
        .map(person)
        .sort((a, b) => sortName(a).localeCompare(sortName(b))),
      officerCapabilities: grants
        .filter(
          grant =>
            grant.subjectRole === FleetScopeRole.OFFICER &&
            grant.effect === ScopeCapabilityEffect.GRANT,
        )
        .map(grant => grant.capability),
      personal: personal.map(grant => ({
        ...person(grant.subjectUserId as string),
        grantId: grant.id,
        capability: grant.capability,
        effect: grant.effect,
        since: grant.validFrom,
      })),
      delegable: delegableAt(scope.kind).map(definition => ({
        code: definition.code,
        name: definition.name,
        description: definition.description,
      })),
    };
  }

  /**
   * Gives somebody a role label here.
   *
   * @param scope - The scope.
   * @param dto - Who, which role, and optionally why.
   * @param actorUserId - The Owner.
   * @throws BadRequestException when they are the Owner or not eligible.
   * @throws ConflictException when they hold a role here already.
   */
  async assign(
    scope: GovernanceScope,
    dto: AssignScopeRoleDto,
    actorUserId: string,
  ): Promise<void> {
    await this._dataSource.transaction(async manager => {
      await this.assertNotOwner(manager, scope, dto.userId);

      if (!(await this.eligible(manager, scope)).includes(dto.userId)) {
        throw new BadRequestException(
          scope.fleetId === null
            ? 'Only an approved member of one of this Community’s Fleets can be given a role here.'
            : 'Only an approved member of this Fleet can be given a role here.',
        );
      }

      const held = await manager.findOne(ScopeRoleAssignmentEntity, {
        where: {
          ...atExactly<ScopeRoleAssignmentEntity>(scope),
          userId: dto.userId,
          role: In(MANAGED_ROLES),
          validTo: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (held !== null) {
        throw new ConflictException(
          `They are ${ROLE_NAMES[held.role]} here already. Withdraw that role first.`,
        );
      }

      const reason = optionalReason(dto.reason);

      await manager.save(
        ScopeRoleAssignmentEntity,
        manager.create(ScopeRoleAssignmentEntity, {
          communityId: scope.communityId,
          fleetId: scope.fleetId,
          armadaId: null,
          userId: dto.userId,
          role: dto.role,
          validFrom: new Date(),
          grantedByUserId: actorUserId,
          reason,
        }),
      );
      await this._log.record(manager, {
        scope,
        action: ScopeGovernanceActionKind.ROLE_ASSIGNED,
        actorUserId,
        subjectUserId: dto.userId,
        role: dto.role,
        reason,
      });
      await this.bump(manager, scope);
    });
  }

  /**
   * Takes a role label away, with a reason.
   *
   * An Admin at the Community who is offered its ownership loses the offer
   * with the role: ownership is offered only to an Admin.
   *
   * @param scope - The scope.
   * @param assignmentId - The assignment.
   * @param reason - Why.
   * @param actorUserId - The Owner.
   * @throws BadRequestException when no reason is given.
   * @throws NotFoundException when there is no such held role here.
   */
  async withdraw(
    scope: GovernanceScope,
    assignmentId: string,
    reason: string | undefined,
    actorUserId: string,
  ): Promise<void> {
    const why = requireReason(reason, 'Say why the role is being withdrawn.');

    await this._dataSource.transaction(async manager => {
      const assignment = await manager.findOne(ScopeRoleAssignmentEntity, {
        where: {
          ...atExactly<ScopeRoleAssignmentEntity>(scope),
          id: assignmentId,
          role: In(MANAGED_ROLES),
          validTo: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (assignment === null) {
        throw new NotFoundException('Not found');
      }

      assignment.validTo = new Date();
      await manager.save(ScopeRoleAssignmentEntity, assignment);
      await this._log.record(manager, {
        scope,
        action: ScopeGovernanceActionKind.ROLE_WITHDRAWN,
        actorUserId,
        subjectUserId: assignment.userId,
        role: assignment.role,
        reason: why,
      });

      if (scope.fleetId === null && assignment.role === FleetScopeRole.ADMIN) {
        await this._transfers.cancelOpenWithin(manager, scope.communityId, {
          actorUserId,
          onlyTo: assignment.userId,
        });
      }

      await this.bump(manager, scope);
    });
  }

  /**
   * Sets what every Officer here holds.
   *
   * @param scope - The scope.
   * @param dto - Every capability Officers should hold, and why.
   * @param actorUserId - The Owner.
   * @throws BadRequestException when a capability cannot be delegated here,
   *   or one is taken away without a reason.
   */
  async setOfficerCapabilities(
    scope: GovernanceScope,
    dto: SetOfficerCapabilitiesDto,
    actorUserId: string,
  ): Promise<void> {
    const wanted = new Set<string>(
      dto.capabilities.map(code => requireDelegable(scope.kind, code)),
    );

    await this._dataSource.transaction(async manager => {
      const open = await manager.find(ScopeCapabilityGrantEntity, {
        where: {
          ...atExactly<ScopeCapabilityGrantEntity>(scope),
          subjectRole: FleetScopeRole.OFFICER,
          validTo: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      });
      const held = new Set(open.map(grant => grant.capability));
      const removed = open.filter(grant => !wanted.has(grant.capability));
      const added = [...wanted].filter(code => !held.has(code));

      if (removed.length === 0 && added.length === 0) {
        return;
      }

      const reason =
        removed.length > 0
          ? requireReason(
              dto.reason,
              'Say why Officers here are losing a capability.',
            )
          : optionalReason(dto.reason);
      const now = new Date();

      for (const grant of removed) {
        grant.validTo = now;
        await manager.save(ScopeCapabilityGrantEntity, grant);
        await this._log.record(manager, {
          scope,
          action: ScopeGovernanceActionKind.CAPABILITY_CLEARED,
          actorUserId,
          role: FleetScopeRole.OFFICER,
          capability: grant.capability,
          clearedEffect: grant.effect,
          reason,
        });
      }

      for (const capability of added) {
        await manager.save(
          ScopeCapabilityGrantEntity,
          manager.create(ScopeCapabilityGrantEntity, {
            communityId: scope.communityId,
            fleetId: scope.fleetId,
            armadaId: null,
            subjectUserId: null,
            subjectRole: FleetScopeRole.OFFICER,
            capability,
            effect: ScopeCapabilityEffect.GRANT,
            validFrom: now,
            grantedByUserId: actorUserId,
            reason,
          }),
        );
        await this._log.record(manager, {
          scope,
          action: ScopeGovernanceActionKind.CAPABILITY_GRANTED,
          actorUserId,
          role: FleetScopeRole.OFFICER,
          capability,
          reason,
        });
      }

      await this.bump(manager, scope);
    });
  }

  /**
   * Grants or denies one capability to one person here.
   *
   * Replaces whatever they held for it already: a grant becomes a denial, or
   * the reverse.
   *
   * @param scope - The scope.
   * @param dto - Who, what, which way, and why.
   * @param actorUserId - The Owner.
   * @throws BadRequestException when the capability cannot be delegated here,
   *   they are the Owner or hold no standing here, or a denial has no reason.
   * @throws ConflictException when they hold exactly that already.
   */
  async setPersonal(
    scope: GovernanceScope,
    dto: SetPersonalCapabilityDto,
    actorUserId: string,
  ): Promise<void> {
    const capability = requireDelegable(scope.kind, dto.capability);
    const reason =
      dto.effect === ScopeCapabilityEffect.DENY
        ? requireReason(dto.reason, 'Say why the capability is being denied.')
        : optionalReason(dto.reason);

    await this._dataSource.transaction(async manager => {
      await this.assertNotOwner(manager, scope, dto.userId);

      const holdsRole = await manager.exists(ScopeRoleAssignmentEntity, {
        where: {
          ...atExactly<ScopeRoleAssignmentEntity>(scope),
          userId: dto.userId,
          validTo: IsNull(),
        },
      });

      if (
        !holdsRole &&
        !(await this.eligible(manager, scope)).includes(dto.userId)
      ) {
        throw new BadRequestException(
          'A capability can only be given to or taken from a member or role holder here.',
        );
      }

      const existing = await manager.findOne(ScopeCapabilityGrantEntity, {
        where: {
          ...atExactly<ScopeCapabilityGrantEntity>(scope),
          subjectUserId: dto.userId,
          capability,
          validTo: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (existing?.effect === dto.effect) {
        throw new ConflictException(
          dto.effect === ScopeCapabilityEffect.GRANT
            ? 'They have been granted that already.'
            : 'They have been denied that already.',
        );
      }

      const now = new Date();

      if (existing !== null) {
        existing.validTo = now;
        await manager.save(ScopeCapabilityGrantEntity, existing);
      }

      await manager.save(
        ScopeCapabilityGrantEntity,
        manager.create(ScopeCapabilityGrantEntity, {
          communityId: scope.communityId,
          fleetId: scope.fleetId,
          armadaId: null,
          subjectUserId: dto.userId,
          subjectRole: null,
          capability,
          effect: dto.effect,
          validFrom: now,
          grantedByUserId: actorUserId,
          reason,
        }),
      );
      await this._log.record(manager, {
        scope,
        action:
          dto.effect === ScopeCapabilityEffect.GRANT
            ? ScopeGovernanceActionKind.CAPABILITY_GRANTED
            : ScopeGovernanceActionKind.CAPABILITY_DENIED,
        actorUserId,
        subjectUserId: dto.userId,
        capability,
        reason,
      });
      await this.bump(manager, scope);
    });
  }

  /**
   * Clears one person's grant or denial here.
   *
   * Clearing a grant takes a power away and needs a reason; clearing a
   * denial gives one back and does not.
   *
   * @param scope - The scope.
   * @param grantId - The grant or denial.
   * @param reason - Why.
   * @param actorUserId - The Owner.
   * @throws NotFoundException when there is no such open one here.
   * @throws BadRequestException when a grant is cleared without a reason.
   */
  async clearPersonal(
    scope: GovernanceScope,
    grantId: string,
    reason: string | undefined,
    actorUserId: string,
  ): Promise<void> {
    await this._dataSource.transaction(async manager => {
      const grant = await manager.findOne(ScopeCapabilityGrantEntity, {
        where: {
          ...atExactly<ScopeCapabilityGrantEntity>(scope),
          id: grantId,
          subjectUserId: Not(IsNull()),
          validTo: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (grant === null) {
        throw new NotFoundException('Not found');
      }

      const why =
        grant.effect === ScopeCapabilityEffect.GRANT
          ? requireReason(reason, 'Say why the capability is being taken away.')
          : optionalReason(reason);

      grant.validTo = new Date();
      await manager.save(ScopeCapabilityGrantEntity, grant);
      await this._log.record(manager, {
        scope,
        action: ScopeGovernanceActionKind.CAPABILITY_CLEARED,
        actorUserId,
        subjectUserId: grant.subjectUserId,
        capability: grant.capability,
        clearedEffect: grant.effect,
        reason: why,
      });
      await this.bump(manager, scope);
    });
  }

  /**
   * Ends every role and grant held at exactly this scope, for a closure.
   *
   * The rows stay, with their dates, so who held what stays answerable.
   *
   * @param manager - The closure's transaction.
   * @param scope - The scope.
   * @param now - When.
   */
  async endAllWithin(
    manager: EntityManager,
    scope: GovernanceScope,
    now: Date,
  ): Promise<void> {
    await manager.update(
      ScopeRoleAssignmentEntity,
      { ...atExactly<ScopeRoleAssignmentEntity>(scope), validTo: IsNull() },
      { validTo: now },
    );
    await manager.update(
      ScopeCapabilityGrantEntity,
      { ...atExactly<ScopeCapabilityGrantEntity>(scope), validTo: IsNull() },
      { validTo: now },
    );
  }

  /**
   * Who may be given a role here.
   *
   * @param manager - The manager.
   * @param scope - The scope.
   * @returns The approved members of the Fleet, or of any Fleet in the
   *   Community.
   */
  private async eligible(
    manager: EntityManager,
    scope: GovernanceScope,
  ): Promise<string[]> {
    const memberships = await manager.find(ScopeMembershipEntity, {
      where: {
        communityId: scope.communityId,
        fleetId: scope.fleetId ?? Not(IsNull()),
        status: ScopeMembershipStatus.APPROVED,
      },
      select: { userId: true },
    });

    return [...new Set(memberships.map(membership => membership.userId))];
  }

  /**
   * Refuses to give or take anything from the Owner, who holds it all.
   *
   * @param manager - The manager.
   * @param scope - The scope.
   * @param userId - Who.
   * @throws BadRequestException when they are the Owner.
   */
  private async assertNotOwner(
    manager: EntityManager,
    scope: GovernanceScope,
    userId: string,
  ): Promise<void> {
    const isOwner = await manager.exists(FleetCommunityEntity, {
      where: { id: scope.communityId, ownerUserId: userId },
    });

    if (isOwner) {
      throw new BadRequestException(
        'The Owner holds every power here already.',
      );
    }
  }

  /**
   * Advertises the change.
   *
   * @param manager - The transaction.
   * @param scope - The scope.
   */
  private async bump(
    manager: EntityManager,
    scope: GovernanceScope,
  ): Promise<void> {
    await this._revisionService.bump(
      scope.fleetId === null ? FleetScopeKind.COMMUNITY : FleetScopeKind.FLEET,
      scope.fleetId ?? scope.communityId,
      manager,
    );
  }
}
