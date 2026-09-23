import { SetMetadata } from '@nestjs/common';

import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetCapability } from './fleet-capability.constants';

export const REQUIRES_SCOPE_CAPABILITY_KEY = 'requiresScopeCapability';

/** Where in the request the scope's identifiers are. */
export interface ScopeSource {
  /** Which kind of object the route acts on. */
  readonly kind: FleetScopeKind;
  /** The route parameter holding that object's identifier. */
  readonly param: string;
  /**
   * The route parameter holding the Community, on a nested route.
   *
   * Supplying it is what turns `/fleet-communities/:communityId/fleets/:id`
   * into a checked claim: a Fleet that belongs to a different Community than
   * the path says resolves to nothing, and the caller is told it does not
   * exist. Leaving it out on a nested route would make the Community segment
   * decorative, which is the shape of most cross-tenant bugs.
   */
  readonly communityParam?: string;
}

/** What {@link RequiresScopeCapability} stores for the guard to read. */
export interface ScopeCapabilityRequirement {
  /**
   * The capability the caller must hold at the scope, or the alternatives,
   * any one of which is enough.
   */
  readonly capability: FleetCapability | readonly FleetCapability[];
  /** Where to find the scope. */
  readonly source: ScopeSource;
}

/**
 * Restricts a route handler to callers holding a capability at the scope the
 * route names.
 *
 * Unlike {@link RequiresPermission}, which is a coarse "may this kind of user
 * reach this endpoint at all", this is a resource-level check and it is safe to
 * make in a guard because the scope is identified by the route rather than by
 * the body — the target does not have to be loaded and interpreted first.
 *
 * Must be combined with an authentication guard so the user is on the request,
 * for example `@UseGuards(JwtAuthGuard, ScopeCapabilityGuard)`. An anonymous
 * caller holds no scoped capability, so the guard refuses them without the
 * authentication guard having to be the thing that stops them.
 *
 * The guard delegates the decision to {@link FleetAuthorisationService}, which
 * is also what a socket handler calls. There is one policy with two entry
 * points, rather than two policies that are meant to agree.
 *
 * @param capability - The capability required at the scope, or the
 *   alternatives, any one of which is enough.
 * @param source - Where in the route the scope's identifiers are.
 * @returns The metadata decorator.
 */
export const RequiresScopeCapability = (
  capability: FleetCapability | readonly FleetCapability[],
  source: ScopeSource,
) =>
  SetMetadata<string, ScopeCapabilityRequirement>(
    REQUIRES_SCOPE_CAPABILITY_KEY,
    { capability, source },
  );
