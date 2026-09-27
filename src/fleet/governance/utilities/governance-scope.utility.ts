import { BadRequestException } from '@nestjs/common';

import { FindOptionsWhere, IsNull } from 'typeorm';

import {
  FLEET_CAPABILITY_BY_CODE,
  FLEET_CAPABILITY_DEFINITIONS,
  FleetCapability,
  FleetCapabilityDefinition,
} from '../../authorisation/fleet-capability.constants';
import { ScopeRef } from '../../authorisation/scope-authorisation.interface';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';

/**
 * A Community or Fleet whose governance is being read or changed (FC-022).
 *
 * Armadas are left for FC-024 to FC-026, which build them: Steve's decision
 * of 27 September 2026.
 */
export interface GovernanceScope {
  /** Which kind it is. */
  readonly kind: FleetScopeKind.COMMUNITY | FleetScopeKind.FLEET;
  /** The Community, which a Fleet also names. */
  readonly communityId: string;
  /** The Fleet, or null for the Community itself. */
  readonly fleetId: string | null;
}

/**
 * Names a Community.
 *
 * @param communityId - The Community.
 * @returns The scope.
 */
export function communityScope(communityId: string): GovernanceScope {
  return { kind: FleetScopeKind.COMMUNITY, communityId, fleetId: null };
}

/**
 * Names a Fleet.
 *
 * @param communityId - The Community holding it.
 * @param fleetId - The Fleet.
 * @returns The scope.
 */
export function fleetScope(
  communityId: string,
  fleetId: string,
): GovernanceScope {
  return { kind: FleetScopeKind.FLEET, communityId, fleetId };
}

/**
 * The reference the authorisation policy takes for a scope.
 *
 * @param scope - The scope.
 * @returns The reference, pinned to its Community.
 */
export function toScopeRef(scope: GovernanceScope): ScopeRef {
  return scope.fleetId === null
    ? { kind: FleetScopeKind.COMMUNITY, id: scope.communityId }
    : {
        kind: FleetScopeKind.FLEET,
        id: scope.fleetId,
        withinCommunityId: scope.communityId,
      };
}

/**
 * Matches rows held at exactly this scope, not at a Fleet inside it.
 *
 * A role or grant at the Community reaches every Fleet in it, so reading the
 * Community's own rows has to exclude the Fleets' rows explicitly.
 *
 * @param scope - The scope.
 * @returns The condition.
 */
export function atExactly<T extends ScopedRow>(
  scope: GovernanceScope,
): FindOptionsWhere<T> {
  return {
    communityId: scope.communityId,
    fleetId: scope.fleetId ?? IsNull(),
    armadaId: IsNull(),
  } as FindOptionsWhere<T>;
}

/** The scope columns every role and grant row has. */
export interface ScopedRow {
  communityId: string;
  fleetId: string | null;
  armadaId: string | null;
}

/**
 * What an Owner may delegate at this kind of scope.
 *
 * The capability ceiling. Only this feature's own scoped capabilities exist
 * here, so a site-wide permission such as site ADMIN is not something a
 * request can name; and the ones that are how ownership is exercised —
 * settings, roles, transfer and closure — are not delegable at all.
 *
 * @param kind - The kind of scope.
 * @returns The definitions, in their declared order.
 */
export function delegableAt(
  kind: GovernanceScope['kind'],
): FleetCapabilityDefinition[] {
  return FLEET_CAPABILITY_DEFINITIONS.filter(
    definition => definition.delegable && definition.scopeKinds.includes(kind),
  );
}

/**
 * Refuses a capability that may not be delegated here.
 *
 * @param kind - The kind of scope.
 * @param code - What was asked for.
 * @returns The capability.
 * @throws BadRequestException when it is unknown, not delegable, or means
 *   nothing at this kind of scope.
 */
export function requireDelegable(
  kind: GovernanceScope['kind'],
  code: string,
): FleetCapability {
  const definition = FLEET_CAPABILITY_BY_CODE.get(code as FleetCapability);

  if (
    definition === undefined ||
    !definition.delegable ||
    !definition.scopeKinds.includes(kind)
  ) {
    throw new BadRequestException(`"${code}" cannot be delegated here.`);
  }

  return definition.code;
}

/**
 * Reads a reason that has to be given.
 *
 * @param reason - What was sent.
 * @param message - What to say when there is none.
 * @returns The reason, trimmed.
 * @throws BadRequestException when it is missing or blank.
 */
export function requireReason(
  reason: string | undefined,
  message: string,
): string {
  const trimmed = reason?.trim() ?? '';

  if (trimmed === '') {
    throw new BadRequestException(message);
  }

  return trimmed;
}

/**
 * Reads a reason that may be given.
 *
 * @param reason - What was sent.
 * @returns The reason, trimmed, or null when there is none.
 */
export function optionalReason(reason: string | undefined): string | null {
  const trimmed = reason?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}
