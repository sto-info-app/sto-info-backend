import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';

import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import {
  DisputeRegistrationDto,
  DisputeScopeDto,
} from '../dto/dispute-registrations.dto';

/** A Fleet or Armada row, as far as a dispute reads it. */
type Registration = StoFleetEntity | StoArmadaEntity;

/**
 * Every registration of a disputed Community's Fleets' and Armadas' names
 * (FC-036), for site admins alone.
 *
 * R02 and Steve's decision of 29 September 2026: STO Info cannot verify who
 * leads a Fleet in the game, so competing registrations of one exact name on
 * one platform are allowed, and a dispute shows each of them with where it
 * came from — its Community and that Community's Owner, when it was
 * registered, its last import and its members — and no claim about which is
 * real. Private registrations, hidden from everybody else, are shown here.
 */
@Injectable()
export class DisputeRegistrationsService {
  /**
   * Creates an instance of DisputeRegistrationsService.
   *
   * @param _dataSource - The database.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * A Community's Fleets, then its Armadas, each with the other
   * registrations of its name.
   *
   * @param communityId - The Community.
   * @returns Each, by name.
   */
  async scopesOf(communityId: string): Promise<DisputeScopeDto[]> {
    const manager = this._dataSource.manager;
    const [fleets, armadas] = await Promise.all([
      manager.find(StoFleetEntity, {
        where: { communityId, deletedAt: IsNull() },
        relations: { platform: true },
        order: { exactGameName: 'ASC' },
      }),
      manager.find(StoArmadaEntity, {
        where: { communityId, deletedAt: IsNull() },
        relations: { platform: true },
        order: { exactGameName: 'ASC' },
      }),
    ]);
    const scopes: DisputeScopeDto[] = [];

    for (const [kind, own, entity] of [
      [FleetScopeKind.FLEET, fleets, StoFleetEntity],
      [FleetScopeKind.ARMADA, armadas, StoArmadaEntity],
    ] as const) {
      for (const registration of own) {
        const duplicates = await manager.find<Registration>(entity, {
          where: {
            platformId: registration.platformId,
            exactGameNameNormalized: registration.exactGameNameNormalized,
            deletedAt: IsNull(),
            id: Not(registration.id),
          },
          relations: { platform: true },
          order: { createdAt: 'DESC' },
        });
        const described = await describe(manager, kind, [
          registration,
          ...duplicates,
        ]);

        scopes.push({ ...described[0], duplicates: described.slice(1) });
      }
    }

    return scopes;
  }
}

/**
 * Describes registrations of one kind, with where each came from.
 *
 * @param manager - The manager to read through.
 * @param kind - Fleets or Armadas.
 * @param registrations - The rows.
 * @returns Each, in the same order.
 */
async function describe(
  manager: EntityManager,
  kind: FleetScopeKind,
  registrations: readonly Registration[],
): Promise<DisputeRegistrationDto[]> {
  const communityIds = [
    ...new Set(
      registrations
        .map(registration => registration.communityId)
        .filter((id): id is string => id !== null),
    ),
  ];
  // Never empty: the first is always the disputed Community's own.
  const communities = await manager.find(FleetCommunityEntity, {
    where: { id: In(communityIds) },
    withDeleted: true,
  });
  const communityById = new Map(communities.map(each => [each.id, each]));
  const owners = await usernamesFor(
    manager,
    communities.map(each => each.ownerUserId),
  );
  const members =
    kind === FleetScopeKind.FLEET
      ? await memberCounts(
          manager,
          registrations.map(registration => registration.id),
        )
      : null;

  return registrations.map(registration => {
    const community =
      registration.communityId === null
        ? undefined
        : communityById.get(registration.communityId);
    const fleet =
      kind === FleetScopeKind.FLEET ? (registration as StoFleetEntity) : null;

    return {
      kind,
      id: registration.id,
      exactGameName: registration.exactGameName,
      platformName: registration.platform.name,
      communityId: registration.communityId,
      communityName: community?.name ?? null,
      communityOwner:
        community?.ownerUserId == null
          ? null
          : {
              userId: community.ownerUserId,
              username: owners.get(community.ownerUserId) ?? null,
            },
      visibility: fleet?.visibility ?? community?.visibility ?? null,
      status: registration.status,
      registeredAt: registration.createdAt,
      lastImportAt: fleet?.lastEffectiveImportAt ?? null,
      memberCount: members?.get(registration.id) ?? (fleet ? 0 : null),
    };
  });
}

/**
 * How many approved members each Fleet has.
 *
 * @param manager - The manager to read through.
 * @param fleetIds - The Fleets.
 * @returns Each Fleet's count, for those with any.
 */
async function memberCounts(
  manager: EntityManager,
  fleetIds: readonly string[],
): Promise<Map<string, number>> {
  const memberships = await manager.find(ScopeMembershipEntity, {
    where: {
      fleetId: In([...fleetIds]),
      status: ScopeMembershipStatus.APPROVED,
      deletedAt: IsNull(),
    },
    select: { id: true, fleetId: true },
  });
  const counts = new Map<string, number>();

  for (const membership of memberships) {
    const fleetId = membership.fleetId as string;

    counts.set(fleetId, (counts.get(fleetId) ?? 0) + 1);
  }

  return counts;
}
