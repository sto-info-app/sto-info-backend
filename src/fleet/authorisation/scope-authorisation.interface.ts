import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';
import { ScopeMembershipStatus } from '../enums/scope-membership-status.enum';
import { FleetCapability } from './fleet-capability.constants';

/**
 * How a caller names the scope it is asking about.
 *
 * It names the object and nothing else. It deliberately cannot assert which
 * Community the object belongs to, because a request that could assert that
 * could lie about it — the resolver reads the owning Community from the row
 * itself. That is half of FC-005's fourth acceptance criterion: a forged
 * Community ID in a body or query has nothing to attach to.
 *
 * The other half is {@link withinCommunityId}, for nested routes such as
 * `/fleet-communities/:communityId/fleets/:fleetId`. There the path makes a
 * claim about the relationship, and a claim that turns out to be false must not
 * be quietly ignored: the scope resolves to nothing at all, so the caller is
 * told the Fleet does not exist rather than which other Community owns it.
 */
export interface ScopeRef {
  /** Which kind of object {@link id} identifies. */
  readonly kind: FleetScopeKind;
  /** The object's own identifier. */
  readonly id: string;
  /**
   * The Community the route claimed the object belongs to, when it named one.
   *
   * When set and wrong, the scope does not resolve.
   */
  readonly withinCommunityId?: string;
}

/**
 * A scope that exists, with the facts the policy needs about it.
 *
 * `communityId` is always populated: a Fleet held as an unregistered
 * observation target has no Community, and such a Fleet is not a scope at all
 * — nobody can hold a role on it, so it never resolves.
 */
export interface ResolvedScope {
  /** Which kind of object this is. */
  readonly kind: FleetScopeKind;
  /** The object's own identifier. */
  readonly id: string;
  /** The owning Community, read from the row rather than from the request. */
  readonly communityId: string;
  /** The Fleet, when this scope is a Fleet. */
  readonly fleetId: string | null;
  /** The Armada, when this scope is an Armada. */
  readonly armadaId: string | null;
  /** The owning Community's owner, who holds Owner over everything in it. */
  readonly communityOwnerUserId: string;
  /** The scope's own lifecycle status. */
  readonly status: FleetScopeStatus;
  /** The owning Community's lifecycle status. */
  readonly communityStatus: FleetScopeStatus;
  /**
   * The status that actually applies.
   *
   * The narrower of the scope's own status and its Community's: closing a
   * Community closes what is inside it, and a Fleet cannot be more open than
   * the Community that holds it.
   */
  readonly effectiveStatus: FleetScopeStatus;
  /**
   * The scope's authorisation revision, and the Community's when they differ.
   *
   * Handed to clients so a socket can be told its view is stale. Plan section
   * 4.2 is explicit that this is a hint: the service check is authoritative
   * even when invalidation is late, so nothing here is ever trusted in place of
   * re-resolving.
   */
  readonly revision: number;
}

/** Everything the policy concluded about one user at one scope. */
export interface ScopeAuthorisation {
  /** The scope the answer is about. */
  readonly scope: ResolvedScope;
  /** The user the answer is about, or null for an anonymous caller. */
  readonly userId: string | null;
  /** The fixed role labels held here, including those inherited. */
  readonly roles: ReadonlySet<FleetScopeRole>;
  /** The capabilities held here, after delegation, denial and suspension. */
  readonly capabilities: ReadonlySet<FleetCapability>;
  /** The membership status at this exact scope, if there is a record. */
  readonly membershipStatus: ScopeMembershipStatus | null;
  /** Whether an approved membership exists at this exact scope. */
  readonly isApprovedMember: boolean;
  /**
   * Whether something has withdrawn everything.
   *
   * True when a suspension applies — at this scope or at its Community — or
   * when the account itself is disabled. Recorded rather than inferred from an
   * empty capability set, because "suspended" and "never had anything" are
   * different answers and only one of them is worth telling somebody.
   */
  readonly isSuspended: boolean;
}
