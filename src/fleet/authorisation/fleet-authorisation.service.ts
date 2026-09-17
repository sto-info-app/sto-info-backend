import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { ClsService } from 'nestjs-cls';
import { IsNull, Not, Repository } from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';

import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { ScopeCapabilityGrantEntity } from '../entities/scope-capability-grant.entity';
import { ScopeMembershipEntity } from '../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../entities/scope-role-assignment.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { ScopeCapabilityEffect } from '../enums/scope-capability-effect.enum';
import { ScopeMembershipStatus } from '../enums/scope-membership-status.enum';
import {
  FLEET_CAPABILITY_BY_CODE,
  FleetCapability,
} from './fleet-capability.constants';
import {
  APPROVED_MEMBERSHIP_CAPABILITIES,
  ROLE_BASELINE_CAPABILITIES,
} from './fleet-role-capabilities.constants';
import {
  ResolvedScope,
  ScopeAuthorisation,
  ScopeRef,
} from './scope-authorisation.interface';

/** CLS key prefix under which a resolved scope authorisation is memoised. */
const CLS_AUTHORISATION_KEY_PREFIX = 'fleetAuthorisation:';

/** CLS key holding every memoisation key written during this request. */
const CLS_AUTHORISATION_INDEX_KEY = 'fleetAuthorisation:keys';

/**
 * The single answer to "may this user do this to this Fleet, Armada or
 * Community".
 *
 * Every caller goes through this service: REST controllers by way of
 * {@link ScopeCapabilityGuard}, services that need a finer answer than a guard
 * can give, and — when they arrive — chat and presence sockets, which call
 * {@link assertCapability} directly. That is FC-005's fourth acceptance
 * criterion, and it is met by there being one implementation rather than by
 * three implementations agreeing.
 *
 * ## What confers what
 *
 * **Site-wide permissions confer nothing here.** This service never reads
 * {@link AccessControlService}, the `permission` table or the user's global
 * role. A site-wide permission answers "may this kind of user reach the Fleet
 * feature at all"; it cannot answer "may they read *this* roster", and wiring
 * the two together is exactly how a support capability turns into access to
 * every Fleet in the application. App-administrator investigation is a separate,
 * reason-logged route (plan section 4.3), not a quiet bypass in this method.
 *
 * **Community-scope roles reach down; memberships do not.** A role assignment
 * at the Community applies to every Fleet and Armada in it, because the
 * Community is what the Fleets belong to and its Owner registered them. An
 * approved *membership* applies only at the exact scope that approved it —
 * R07, "joining a community never unlocks a private roster". Nothing reaches
 * sideways: a role on one Fleet says nothing about a sibling Fleet, and a role
 * on an Armada says nothing about the Fleets placed in it, which is what stops
 * Armada membership becoming a route to other people's rosters.
 *
 * **Following confers nothing at all.** `community_subscription` is not read by
 * this service, at any point, for any purpose. Neither is any roster table: an
 * imported row naming a Character is evidence, not an access grant (ADR-0002),
 * and a Guild Rank in a CSV is a label somebody typed in a game client. That is
 * FC-005's second and third acceptance criteria, and the strongest form of the
 * guarantee is that the query which would implement the loophole does not
 * exist.
 *
 * ## What takes it away
 *
 * A `DENY` grant, a `SUSPENDED` membership at the scope or at its Community,
 * and a disabled account each withdraw capabilities, and none of them can be
 * outvoted by a role. A scope that is `SUSPENDED` or `CLOSED` keeps its reading
 * capabilities and loses every mutating one, so its history stays legible while
 * nothing new can be attached to it.
 *
 * Results are memoised per request in the same way the site-wide service
 * memoises permissions, so a handler that checks three capabilities on one
 * Fleet costs one set of queries. Memoisation lasts one request only; a
 * revision bump does not have to reach into it.
 */
@Injectable()
export class FleetAuthorisationService {
  private readonly _logger = new Logger(FleetAuthorisationService.name);

  /**
   * Creates an instance of FleetAuthorisationService.
   *
   * @param _communityRepository - Repository of Fleet Communities.
   * @param _fleetRepository - Repository of Fleets.
   * @param _armadaRepository - Repository of Armadas.
   * @param _membershipRepository - Repository of scope memberships.
   * @param _roleRepository - Repository of scope role assignments.
   * @param _grantRepository - Repository of scoped capability grants.
   * @param _userRepository - Repository used to read account status.
   * @param _cls - Request-scoped storage used to memoise resolved answers.
   */
  constructor(
    @InjectRepository(FleetCommunityEntity)
    private readonly _communityRepository: Repository<FleetCommunityEntity>,
    @InjectRepository(StoFleetEntity)
    private readonly _fleetRepository: Repository<StoFleetEntity>,
    @InjectRepository(StoArmadaEntity)
    private readonly _armadaRepository: Repository<StoArmadaEntity>,
    @InjectRepository(ScopeMembershipEntity)
    private readonly _membershipRepository: Repository<ScopeMembershipEntity>,
    @InjectRepository(ScopeRoleAssignmentEntity)
    private readonly _roleRepository: Repository<ScopeRoleAssignmentEntity>,
    @InjectRepository(ScopeCapabilityGrantEntity)
    private readonly _grantRepository: Repository<ScopeCapabilityGrantEntity>,
    @InjectRepository(UserEntity)
    private readonly _userRepository: Repository<UserEntity>,
    private readonly _cls: ClsService,
  ) {}

  /**
   * Resolves the scope a caller named, reading its Community from the row.
   *
   * @param ref - The scope the caller named.
   * @returns The resolved scope, or null when it does not exist, has been
   *   deleted, has no owning Community, or does not belong to the Community the
   *   route claimed.
   */
  async resolveScope(ref: ScopeRef): Promise<ResolvedScope | null> {
    switch (ref.kind) {
      case FleetScopeKind.COMMUNITY:
        return this.resolveCommunityScope(ref);
      case FleetScopeKind.FLEET:
        return this.resolveFleetScope(ref);
      // Every kind is named, so a kind added to the enum without a branch here
      // is a compile error rather than a scope that silently resolves to null.
      case FleetScopeKind.ARMADA:
        return this.resolveArmadaScope(ref);
    }
  }

  /**
   * Works out everything a user may do at a scope.
   *
   * @param userId - The user acting, or null for an anonymous caller.
   * @param ref - The scope they are acting on.
   * @returns The authorisation, or null when the scope does not resolve.
   */
  async authorise(
    userId: string | null,
    ref: ScopeRef,
  ): Promise<ScopeAuthorisation | null> {
    const cached = this.readCache(userId, ref);
    if (cached !== null) {
      return cached;
    }

    const scope = await this.resolveScope(ref);

    if (scope === null) {
      return null;
    }

    const resolved =
      userId === null
        ? this.anonymousAuthorisation(scope)
        : await this.resolveAuthorisation(userId, scope);

    this.writeCache(userId, ref, resolved);
    return resolved;
  }

  /**
   * Reports whether a user holds a capability at a scope.
   *
   * @param userId - The user acting, or null for an anonymous caller.
   * @param ref - The scope they are acting on.
   * @param capability - What they are trying to do.
   * @returns True when they hold it. A scope that does not resolve is false,
   *   never an error, so a caller that only wants to decide what to render does
   *   not have to catch anything.
   */
  async hasCapability(
    userId: string | null,
    ref: ScopeRef,
    capability: FleetCapability,
  ): Promise<boolean> {
    const authorisation = await this.authorise(userId, ref);

    return authorisation?.capabilities.has(capability) ?? false;
  }

  /**
   * Requires that a user holds a capability at a scope.
   *
   * @param userId - The user acting, or null for an anonymous caller.
   * @param ref - The scope they are acting on.
   * @param capability - What they are trying to do.
   * @returns The authorisation, so a caller that needs more than the one answer
   *   does not have to resolve twice.
   * @throws NotFoundException when the scope does not resolve. A scope that
   *   belongs to another Community is reported the same way as one that was
   *   never created, so a probe cannot use the difference between 403 and 404
   *   to confirm that a Fleet exists somewhere else.
   * @throws ForbiddenException when the scope resolves and the capability is
   *   not held.
   */
  async assertCapability(
    userId: string | null,
    ref: ScopeRef,
    capability: FleetCapability,
  ): Promise<ScopeAuthorisation> {
    const authorisation = await this.authorise(userId, ref);

    if (authorisation === null) {
      throw new NotFoundException('Not found');
    }

    if (authorisation.capabilities.has(capability)) {
      return authorisation;
    }

    // Logged where the denial happens so an authorisation failure is
    // diagnosable without reconstructing which of several checks rejected it.
    this._logger.warn(
      `Scope capability denied: user ${userId ?? 'anonymous'} lacks '${capability}' on ${ref.kind} ${ref.id}`,
    );
    throw new ForbiddenException('Insufficient permissions');
  }

  /**
   * Resolves a Community scope.
   *
   * @param ref - The scope the caller named.
   * @returns The resolved scope, or null.
   */
  private async resolveCommunityScope(
    ref: ScopeRef,
  ): Promise<ResolvedScope | null> {
    if (
      ref.withinCommunityId !== undefined &&
      ref.withinCommunityId !== ref.id
    ) {
      return null;
    }

    const community = await this._communityRepository.findOne({
      where: { id: ref.id, deletedAt: IsNull() },
      select: { id: true, ownerUserId: true, status: true, revision: true },
    });

    if (!community) {
      return null;
    }

    return {
      kind: FleetScopeKind.COMMUNITY,
      id: community.id,
      communityId: community.id,
      fleetId: null,
      armadaId: null,
      communityOwnerUserId: community.ownerUserId,
      status: community.status,
      communityStatus: community.status,
      effectiveStatus: community.status,
      revision: community.revision,
    };
  }

  /**
   * Resolves a Fleet scope.
   *
   * A Fleet with no `communityId` is an explicitly confirmed unregistered
   * observation target, kept so imports have something to attach to. It is not
   * a scope: nobody owns it, nobody can hold a role on it, and it never
   * resolves.
   *
   * @param ref - The scope the caller named.
   * @returns The resolved scope, or null.
   */
  private async resolveFleetScope(
    ref: ScopeRef,
  ): Promise<ResolvedScope | null> {
    const fleet = await this._fleetRepository.findOne({
      where: { id: ref.id, deletedAt: IsNull() },
      select: { id: true, communityId: true, status: true, revision: true },
    });

    if (!fleet || fleet.communityId === null) {
      return null;
    }

    const community = await this.findOwningCommunity(fleet.communityId, ref);

    if (community === null) {
      return null;
    }

    return {
      kind: FleetScopeKind.FLEET,
      id: fleet.id,
      communityId: community.id,
      fleetId: fleet.id,
      armadaId: null,
      communityOwnerUserId: community.ownerUserId,
      status: fleet.status,
      communityStatus: community.status,
      effectiveStatus: narrowerStatus(fleet.status, community.status),
      revision: fleet.revision,
    };
  }

  /**
   * Resolves an Armada scope.
   *
   * @param ref - The scope the caller named.
   * @returns The resolved scope, or null.
   */
  private async resolveArmadaScope(
    ref: ScopeRef,
  ): Promise<ResolvedScope | null> {
    const armada = await this._armadaRepository.findOne({
      where: { id: ref.id, deletedAt: IsNull() },
      select: { id: true, communityId: true, status: true, revision: true },
    });

    if (!armada) {
      return null;
    }

    const community = await this.findOwningCommunity(armada.communityId, ref);

    if (community === null) {
      return null;
    }

    return {
      kind: FleetScopeKind.ARMADA,
      id: armada.id,
      communityId: community.id,
      fleetId: null,
      armadaId: armada.id,
      communityOwnerUserId: community.ownerUserId,
      status: armada.status,
      communityStatus: community.status,
      effectiveStatus: narrowerStatus(armada.status, community.status),
      revision: armada.revision,
    };
  }

  /**
   * Reads the Community a child belongs to, checking any claim the route made.
   *
   * @param communityId - The Community recorded on the child row.
   * @param ref - The scope the caller named.
   * @returns The Community, or null when it is gone or the route's claim about
   *   it was wrong.
   */
  private async findOwningCommunity(
    communityId: string,
    ref: ScopeRef,
  ): Promise<FleetCommunityEntity | null> {
    if (
      ref.withinCommunityId !== undefined &&
      ref.withinCommunityId !== communityId
    ) {
      return null;
    }

    return this._communityRepository.findOne({
      where: { id: communityId, deletedAt: IsNull() },
      select: { id: true, ownerUserId: true, status: true, revision: true },
    });
  }

  /**
   * Builds the answer for a caller who is not signed in.
   *
   * Anonymous callers hold no capability anywhere. Public *visibility* is a
   * separate question, answered by {@link FleetAudienceService}, because a
   * public Fleet page is readable by somebody who may do nothing to it.
   *
   * @param scope - The resolved scope.
   * @returns An authorisation holding nothing.
   */
  private anonymousAuthorisation(scope: ResolvedScope): ScopeAuthorisation {
    return {
      scope,
      userId: null,
      roles: new Set<FleetScopeRole>(),
      capabilities: new Set<FleetCapability>(),
      membershipStatus: null,
      isApprovedMember: false,
      isSuspended: false,
    };
  }

  /**
   * Works out a signed-in user's roles and capabilities at a resolved scope.
   *
   * @param userId - The user acting.
   * @param scope - The resolved scope.
   * @returns The authorisation.
   */
  private async resolveAuthorisation(
    userId: string,
    scope: ResolvedScope,
  ): Promise<ScopeAuthorisation> {
    const [user, memberships, assignments, grants] = await Promise.all([
      this._userRepository.findOne({
        where: { id: userId },
        select: { id: true, isAccountDisabled: true },
      }),
      this.findMemberships(userId, scope.communityId),
      this.findRoleAssignments(userId, scope.communityId),
      this.findGrants(userId, scope.communityId),
    ]);

    const applicableMemberships = memberships.filter(membership =>
      appliesToScope(membership, scope),
    );
    const exactMembership =
      applicableMemberships.find(membership =>
        isExactScope(membership, scope),
      ) ?? null;

    const isSuspended =
      !user ||
      user.isAccountDisabled ||
      applicableMemberships.some(
        membership => membership.status === ScopeMembershipStatus.SUSPENDED,
      );

    const roles = this.collectRoles(userId, scope, assignments, isSuspended);

    const capabilities = isSuspended
      ? new Set<FleetCapability>()
      : this.collectCapabilities(scope, roles, exactMembership, grants);

    return {
      scope,
      userId,
      roles,
      capabilities,
      membershipStatus: exactMembership?.status ?? null,
      isApprovedMember:
        exactMembership?.status === ScopeMembershipStatus.APPROVED,
      isSuspended,
    };
  }

  /**
   * Collects the fixed role labels a user holds at a scope.
   *
   * The Community's own `ownerUserId` confers `OWNER` without a role row. The
   * registrant becomes Owner at the moment of creation (R02), and requiring a
   * separate assignment row for that would mean a Community could exist for one
   * statement of a transaction with nobody able to administer it.
   *
   * @param userId - The user acting.
   * @param scope - The resolved scope.
   * @param assignments - The user's open assignments anywhere in the Community.
   * @param isSuspended - Whether something has withdrawn everything.
   * @returns The role labels held here.
   */
  private collectRoles(
    userId: string,
    scope: ResolvedScope,
    assignments: ScopeRoleAssignmentEntity[],
    isSuspended: boolean,
  ): ReadonlySet<FleetScopeRole> {
    const roles = new Set<FleetScopeRole>();

    if (isSuspended) {
      return roles;
    }

    if (scope.communityOwnerUserId === userId) {
      roles.add(FleetScopeRole.OWNER);
    }

    for (const assignment of assignments) {
      if (appliesToScope(assignment, scope)) {
        roles.add(assignment.role);
      }
    }

    return roles;
  }

  /**
   * Works out the capability set from roles, membership and grants.
   *
   * @param scope - The resolved scope.
   * @param roles - The role labels held here.
   * @param exactMembership - The membership at this exact scope, if any.
   * @param grants - The user's open grants anywhere in the Community.
   * @returns The capabilities held here.
   */
  private collectCapabilities(
    scope: ResolvedScope,
    roles: ReadonlySet<FleetScopeRole>,
    exactMembership: ScopeMembershipEntity | null,
    grants: ScopeCapabilityGrantEntity[],
  ): ReadonlySet<FleetCapability> {
    const held = new Set<FleetCapability>();

    for (const role of roles) {
      for (const capability of ROLE_BASELINE_CAPABILITIES[role]) {
        held.add(capability);
      }
    }

    if (exactMembership?.status === ScopeMembershipStatus.APPROVED) {
      for (const capability of APPROVED_MEMBERSHIP_CAPABILITIES) {
        held.add(capability);
      }
    }

    const applicable = grants.filter(
      grant =>
        appliesToScope(grant, scope) && grantSubjectMatches(grant, roles),
    );

    // Two passes, granting before denying, so a DENY cannot be undone by a
    // GRANT that happens to be read after it. Ordering an authorisation
    // decision by row order is a bug waiting for a query plan to change.
    for (const grant of applicable) {
      const capability = recognisedCapability(grant.capability);

      if (capability !== null && grant.effect === ScopeCapabilityEffect.GRANT) {
        held.add(capability);
      }
    }

    for (const grant of applicable) {
      const capability = recognisedCapability(grant.capability);

      if (capability !== null && grant.effect === ScopeCapabilityEffect.DENY) {
        held.delete(capability);
      }
    }

    return this.applyScopeLimits(scope, held);
  }

  /**
   * Withdraws capabilities the scope itself cannot carry.
   *
   * Two filters, both of which a call site could get wrong and neither of which
   * a call site should have to remember. A capability that means nothing at
   * this kind of scope is never held there, so `armada.manage` cannot be
   * claimed against a Fleet. A scope that is not `ACTIVE` keeps everything that
   * reads and loses everything that writes, which is what "readable, but no new
   * activity is accepted" means in practice.
   *
   * @param scope - The resolved scope.
   * @param held - The capabilities conferred before these limits.
   * @returns The capabilities that survive them.
   */
  private applyScopeLimits(
    scope: ResolvedScope,
    held: ReadonlySet<FleetCapability>,
  ): ReadonlySet<FleetCapability> {
    const isActive = scope.effectiveStatus === FleetScopeStatus.ACTIVE;
    const allowed = new Set<FleetCapability>();

    for (const capability of held) {
      const definition = FLEET_CAPABILITY_BY_CODE.get(capability);

      if (
        definition === undefined ||
        !definition.scopeKinds.includes(scope.kind)
      ) {
        continue;
      }

      if (definition.mutating && !isActive) {
        continue;
      }

      allowed.add(capability);
    }

    return allowed;
  }

  /**
   * Finds a user's live memberships anywhere in a Community.
   *
   * @param userId - The user.
   * @param communityId - The Community.
   * @returns The membership rows.
   */
  private findMemberships(
    userId: string,
    communityId: string,
  ): Promise<ScopeMembershipEntity[]> {
    return this._membershipRepository.find({
      where: { userId, communityId, deletedAt: IsNull() },
    });
  }

  /**
   * Finds a user's open role assignments anywhere in a Community.
   *
   * @param userId - The user.
   * @param communityId - The Community.
   * @returns The assignment rows that are currently open.
   */
  private findRoleAssignments(
    userId: string,
    communityId: string,
  ): Promise<ScopeRoleAssignmentEntity[]> {
    return this._roleRepository.find({
      where: { userId, communityId, validTo: IsNull(), deletedAt: IsNull() },
    });
  }

  /**
   * Finds the open capability grants that could reach a user in a Community.
   *
   * Reads grants naming the user and grants naming any role label, because
   * which labels the user holds is not known until the assignments have been
   * read and the Community owner has been considered. Filtering the role ones
   * down happens in memory; the alternative is a second round trip to ask a
   * question the first round trip has already fetched the answer to.
   *
   * @param userId - The user.
   * @param communityId - The Community.
   * @returns The grant rows that are currently open.
   */
  private findGrants(
    userId: string,
    communityId: string,
  ): Promise<ScopeCapabilityGrantEntity[]> {
    const open = { communityId, validTo: IsNull(), deletedAt: IsNull() };

    return this._grantRepository.find({
      where: [
        { ...open, subjectUserId: userId },
        { ...open, subjectRole: Not(IsNull()) },
      ],
    });
  }

  /**
   * Reads a memoised authorisation for the current request.
   *
   * @param userId - The user the answer is about.
   * @param ref - The scope the answer is about.
   * @returns The memoised answer, or null when nothing is cached.
   */
  private readCache(
    userId: string | null,
    ref: ScopeRef,
  ): ScopeAuthorisation | null {
    if (!this._cls.isActive()) {
      return null;
    }

    return (
      this._cls.get<ScopeAuthorisation | undefined>(cacheKey(userId, ref)) ??
      null
    );
  }

  /**
   * Memoises an authorisation for the lifetime of the current request.
   *
   * @param userId - The user the answer is about.
   * @param ref - The scope the answer is about.
   * @param authorisation - The answer.
   */
  private writeCache(
    userId: string | null,
    ref: ScopeRef,
    authorisation: ScopeAuthorisation,
  ): void {
    if (!this._cls.isActive()) {
      return;
    }

    const key = cacheKey(userId, ref);
    const written =
      this._cls.get<Set<string> | undefined>(CLS_AUTHORISATION_INDEX_KEY) ??
      new Set<string>();

    written.add(key);
    this._cls.set(CLS_AUTHORISATION_INDEX_KEY, written);
    this._cls.set(key, authorisation);
  }

  /**
   * Forgets every memoised answer about one scope in the current request.
   *
   * Called after a permission mutation, so a handler that grants a role and
   * then re-reads the caller's capabilities in the same request sees the grant
   * rather than the answer it memoised a few statements earlier. Without this
   * the memoisation — which exists to make several checks cheap — would make a
   * mutation invisible to its own response body.
   *
   * It clears one scope's answers for every user, not just the caller's,
   * because the user whose access changed is usually not the user making the
   * change.
   *
   * @param kind - The kind of scope that changed.
   * @param id - The scope's identifier.
   */
  invalidate(kind: FleetScopeKind, id: string): void {
    if (!this._cls.isActive()) {
      return;
    }

    const written = this._cls.get<Set<string> | undefined>(
      CLS_AUTHORISATION_INDEX_KEY,
    );

    if (written === undefined) {
      return;
    }

    const needle = `:${kind}:${id}:`;

    for (const key of written) {
      if (key.includes(needle)) {
        this._cls.set(key, undefined);
        written.delete(key);
      }
    }
  }
}

/** A row that names a scope the way the three scoped tables all do. */
interface ScopedRow {
  readonly fleetId: string | null;
  readonly armadaId: string | null;
}

/**
 * Reports whether a scoped row reaches a scope.
 *
 * A Community-level row — neither child ID set — reaches everything in the
 * Community. A Fleet row reaches that Fleet only, and an Armada row that Armada
 * only. Nothing reaches sideways to a sibling, and nothing reaches from an
 * Armada into the Fleets placed in it.
 *
 * @param row - The membership, assignment or grant.
 * @param scope - The scope being asked about.
 * @returns True when the row applies.
 */
function appliesToScope(row: ScopedRow, scope: ResolvedScope): boolean {
  if (row.fleetId === null && row.armadaId === null) {
    return true;
  }

  return isExactScope(row, scope);
}

/**
 * Reports whether a scoped row names exactly this scope and no wider one.
 *
 * @param row - The membership, assignment or grant.
 * @param scope - The scope being asked about.
 * @returns True when the row names this scope itself.
 */
function isExactScope(row: ScopedRow, scope: ResolvedScope): boolean {
  if (scope.kind === FleetScopeKind.FLEET) {
    return row.fleetId === scope.fleetId;
  }

  if (scope.kind === FleetScopeKind.ARMADA) {
    return row.armadaId === scope.armadaId;
  }

  return row.fleetId === null && row.armadaId === null;
}

/**
 * Reports whether a grant's subject is this user.
 *
 * A grant naming a user was already filtered to this user by the query. A grant
 * naming a role applies when the user holds that role here — including a role
 * inherited from the Community, so "Officers of this Fleet may import rosters"
 * covers an Officer appointed at the Community.
 *
 * @param grant - The grant row.
 * @param roles - The role labels the user holds at the scope.
 * @returns True when the grant is about this user.
 */
function grantSubjectMatches(
  grant: ScopeCapabilityGrantEntity,
  roles: ReadonlySet<FleetScopeRole>,
): boolean {
  if (grant.subjectRole !== null) {
    return roles.has(grant.subjectRole);
  }

  return true;
}

/**
 * Narrows a stored capability code to one the application still recognises.
 *
 * A grant written by an earlier version may name a capability that has since
 * been removed. Such a row confers nothing and denies nothing rather than
 * throwing, because an obsolete row must not be able to take a Fleet offline.
 *
 * @param code - The stored code.
 * @returns The capability, or null when it is not recognised.
 */
function recognisedCapability(code: string): FleetCapability | null {
  const capability = code as FleetCapability;

  return FLEET_CAPABILITY_BY_CODE.has(capability) ? capability : null;
}

/**
 * Picks the narrower of two lifecycle statuses.
 *
 * Closing a Community closes what is inside it, so a Fleet is never more open
 * than the Community holding it.
 *
 * @param own - The scope's own status.
 * @param community - The owning Community's status.
 * @returns Whichever admits less.
 */
function narrowerStatus(
  own: FleetScopeStatus,
  community: FleetScopeStatus,
): FleetScopeStatus {
  const order = [
    FleetScopeStatus.ACTIVE,
    FleetScopeStatus.SUSPENDED,
    FleetScopeStatus.CLOSED,
  ];

  return order.indexOf(community) > order.indexOf(own) ? community : own;
}

/**
 * Builds the per-request memoisation key for one question.
 *
 * The claimed Community is part of the key: the same Fleet asked about with and
 * without a nested route answers differently, and one answer must not be served
 * for the other question.
 *
 * @param userId - The user the answer is about.
 * @param ref - The scope the answer is about.
 * @returns The key.
 */
function cacheKey(userId: string | null, ref: ScopeRef): string {
  return `${CLS_AUTHORISATION_KEY_PREFIX}${userId ?? 'anonymous'}:${ref.kind}:${ref.id}:${ref.withinCommunityId ?? '-'}`;
}
