import { EntityManager } from 'typeorm';

import { ScopeRef } from '../authorisation/scope-authorisation.interface';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { GovernanceScope } from '../governance/utilities/governance-scope.utility';
import { toPlatformSegment } from './platform-segment.utility';

/** A Community, Fleet or Armada: its name, its page, and how to ask about it. */
export interface ScopePlace {
  readonly kind: FleetScopeKind;
  readonly name: string;
  /** Its page on the site. */
  readonly path: string;
  readonly ref: ScopeRef;
  readonly scope: GovernanceScope;
}

/** Where something is, by the IDs it records. */
export interface ScopeIds {
  readonly communityId: string;
  readonly fleetId: string | null;
  readonly armadaId: string | null;
}

/**
 * Names the scope something belongs to and where its page is (FC-029,
 * FC-030), for feeds and lists that gather several scopes.
 *
 * @param manager - The manager to read through.
 * @param ids - The Community, and the Fleet or Armada if any.
 * @returns The scope, or null when it has gone.
 */
export async function scopePlaceOf(
  manager: EntityManager,
  ids: ScopeIds,
): Promise<ScopePlace | null> {
  const community = await manager.findOne(FleetCommunityEntity, {
    where: { id: ids.communityId },
    select: { id: true, name: true, slug: true },
  });

  if (community === null) {
    return null;
  }

  const base = `/fleets/communities/${community.slug}`;

  if (ids.fleetId !== null) {
    const fleet = await manager.findOne(StoFleetEntity, {
      where: { id: ids.fleetId },
      relations: { platform: true },
    });

    return fleet === null
      ? null
      : {
          kind: FleetScopeKind.FLEET,
          name: fleet.exactGameName,
          path: `${base}/fleets/${toPlatformSegment(fleet.platform.name)}/${fleet.slug}`,
          ref: {
            kind: FleetScopeKind.FLEET,
            id: fleet.id,
            withinCommunityId: community.id,
          },
          scope: {
            kind: FleetScopeKind.FLEET,
            communityId: community.id,
            fleetId: fleet.id,
            armadaId: null,
          },
        };
  }

  if (ids.armadaId !== null) {
    const armada = await manager.findOne(StoArmadaEntity, {
      where: { id: ids.armadaId },
      relations: { platform: true },
    });

    return armada === null
      ? null
      : {
          kind: FleetScopeKind.ARMADA,
          name: armada.exactGameName,
          path: `${base}/armadas/${toPlatformSegment(armada.platform.name)}/${armada.slug}`,
          ref: {
            kind: FleetScopeKind.ARMADA,
            id: armada.id,
            withinCommunityId: community.id,
          },
          scope: {
            kind: FleetScopeKind.ARMADA,
            communityId: community.id,
            fleetId: null,
            armadaId: armada.id,
          },
        };
  }

  return {
    kind: FleetScopeKind.COMMUNITY,
    name: community.name,
    path: base,
    ref: { kind: FleetScopeKind.COMMUNITY, id: community.id },
    scope: {
      kind: FleetScopeKind.COMMUNITY,
      communityId: community.id,
      fleetId: null,
      armadaId: null,
    },
  };
}
