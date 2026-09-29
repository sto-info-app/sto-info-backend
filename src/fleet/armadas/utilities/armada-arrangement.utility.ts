import { randomUUID } from 'node:crypto';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import { EntityManager, In, IsNull, Not } from 'typeorm';

import { GeneralFactionEntity } from 'src/sto/character/entities/general-faction.entity';

import { ActivityType } from '../../activity/enums/activity.enums';
import {
  ActivityRecord,
  recordActivity,
} from '../../activity/utilities/record-activity.utility';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ArmadaPosition } from '../../enums/armada-position.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ScopeGovernanceActionEntity } from '../../governance/entities/scope-governance-action.entity';
import { ScopeGovernanceActionKind } from '../../governance/enums/scope-governance-action-kind.enum';
import { endAndLog } from '../../governance/utilities/governance-endings.utility';
import { ArmadaActionEntity } from '../entities/armada-action.entity';
import { ArmadaJoinRequestEntity } from '../entities/armada-join-request.entity';
import { ArmadaActionKind } from '../enums/armada-action-kind.enum';
import { ArmadaJoinRequestStatus } from '../enums/armada-join-request-status.enum';

/** The most Betas an Armada has. */
export const MAX_ARMADA_BETAS = 3;

/** The most Gammas one Beta has. */
export const MAX_ARMADA_GAMMAS_PER_BETA = 3;

/** Why an Armada role ends when its holder no longer belongs. */
export const ARMADA_ROLE_ENDED_REASON =
  'They are no longer a member of any Fleet in this Armada.';

/** Where a Fleet sits in an Armada. */
export interface ArmadaSlot {
  readonly position: ArmadaPosition;
  /** The Beta a Gamma sits under; null for an Alpha or a Beta. */
  readonly parentFleetId: string | null;
}

/** What one change does to one Fleet. */
export interface ArmadaChange {
  /** Where it goes, or null when it comes out. */
  readonly slot: ArmadaSlot | null;
  /** How the history records it. */
  readonly action: ArmadaActionKind;
}

/** Who made a change, and why. */
export interface ArmadaChangeContext {
  readonly actorUserId: string | null;
  /** Shared by every row of the change. */
  readonly reason: string | null;
  /** The request an approval answers. */
  readonly requestId?: string | null;
  readonly now: Date;
}

/**
 * Locks an Armada's row for a change to its shape, so changes to one Armada
 * are taken one at a time and each sees what the one before it did.
 *
 * @param manager - The change's transaction.
 * @param communityId - The Community named in the route.
 * @param armadaId - The Armada.
 * @returns The Armada.
 * @throws NotFoundException when that Community holds no such Armada.
 */
export async function lockArmada(
  manager: EntityManager,
  communityId: string,
  armadaId: string,
): Promise<StoArmadaEntity> {
  const armada = await manager.findOne(StoArmadaEntity, {
    where: { id: armadaId, communityId, deletedAt: IsNull() },
    lock: { mode: 'pessimistic_write' },
  });

  if (!armada) {
    throw new NotFoundException('Not found');
  }

  return armada;
}

/**
 * Reads an Armada's open placements.
 *
 * @param manager - The manager.
 * @param armadaId - The Armada.
 * @returns Each placement that has not ended.
 */
export function openPlacements(
  manager: EntityManager,
  armadaId: string,
): Promise<ArmadaFleetMembershipEntity[]> {
  return manager.find(ArmadaFleetMembershipEntity, {
    where: { armadaId, validTo: IsNull(), deletedAt: IsNull() },
    order: { validFrom: 'ASC' },
  });
}

/**
 * Puts open placements as where each Fleet sits.
 *
 * @param placements - The open placements.
 * @returns Each placed Fleet's slot.
 */
export function arrangementOf(
  placements: readonly ArmadaFleetMembershipEntity[],
): Map<string, ArmadaSlot> {
  const fleetOf = new Map(
    placements.map(placement => [placement.id, placement.fleetId]),
  );

  return new Map(
    placements.map(placement => [
      placement.fleetId,
      {
        position: placement.position,
        parentFleetId:
          placement.parentMembershipId === null
            ? null
            : (fleetOf.get(placement.parentMembershipId) ?? null),
      },
    ]),
  );
}

/**
 * Checks an arrangement against the game's structure: one Alpha, at most
 * three Betas, and at most three Gammas under each Beta.
 *
 * @param arrangement - Where each Fleet would sit.
 * @param before - Where each sat before, to name a Beta whose Gammas were
 *   left without it.
 * @param nameOf - A Fleet's name, for the explanation.
 * @throws BadRequestException naming what does not fit.
 */
export function assertArrangement(
  arrangement: ReadonlyMap<string, ArmadaSlot>,
  before: ReadonlyMap<string, ArmadaSlot>,
  nameOf: (fleetId: string) => string,
): void {
  const slots = [...arrangement.entries()];
  const alphas = slots.filter(
    ([, slot]) => slot.position === ArmadaPosition.ALPHA,
  );
  const betas = new Set(
    slots
      .filter(([, slot]) => slot.position === ArmadaPosition.BETA)
      .map(([fleetId]) => fleetId),
  );

  if (alphas.length > 1) {
    throw new BadRequestException('An Armada has one Alpha.');
  }

  if (betas.size > MAX_ARMADA_BETAS) {
    throw new BadRequestException(
      `An Armada has at most ${MAX_ARMADA_BETAS} Betas.`,
    );
  }

  const gammasUnder = new Map<string, number>();

  for (const [fleetId, slot] of slots) {
    if (slot.position !== ArmadaPosition.GAMMA) {
      continue;
    }

    const parent = slot.parentFleetId as string;

    if (!betas.has(parent)) {
      throw new BadRequestException(
        before.get(parent)?.position === ArmadaPosition.BETA &&
          before.get(fleetId)?.parentFleetId === parent
          ? `Say where each of ${nameOf(parent)}’s Gammas goes.`
          : 'A Gamma has to sit under one of this Armada’s Betas.',
      );
    }

    gammasUnder.set(parent, (gammasUnder.get(parent) ?? 0) + 1);
  }

  for (const [beta, count] of gammasUnder) {
    if (count > MAX_ARMADA_GAMMAS_PER_BETA) {
      throw new BadRequestException(
        `${nameOf(beta)} can have at most ${MAX_ARMADA_GAMMAS_PER_BETA} Gammas.`,
      );
    }
  }
}

/**
 * Makes one change to an Armada's shape, under its lock.
 *
 * Works out where every Fleet would sit afterwards and checks the whole of
 * it, so a change that would leave a Gamma under nothing, or a Beta with a
 * fourth Gamma, is refused before anything is written. A Fleet that moves
 * ends its placement and starts another, so where it was stays readable;
 * each Fleet the change touches gets one history row, all sharing the
 * change's reason. The Armada's authorisation revision moves on, because
 * who counts as its member may have changed.
 *
 * @param manager - The change's transaction, holding the Armada's lock.
 * @param armada - The Armada.
 * @param placements - Its open placements, read under the lock.
 * @param changes - What happens to each Fleet the change touches.
 * @param context - Who, why and when.
 * @returns The placements the change started, by Fleet.
 * @throws BadRequestException when the result does not fit the structure.
 */
export async function applyArmadaChange(
  manager: EntityManager,
  armada: StoArmadaEntity,
  placements: readonly ArmadaFleetMembershipEntity[],
  changes: ReadonlyMap<string, ArmadaChange>,
  context: ArmadaChangeContext,
): Promise<Map<string, ArmadaFleetMembershipEntity>> {
  const before = arrangementOf(placements);
  const after = new Map(before);

  for (const [fleetId, change] of changes) {
    if (change.slot === null) {
      after.delete(fleetId);
    } else {
      after.set(fleetId, change.slot);
    }
  }

  assertArrangement(
    after,
    before,
    await fleetNamer(manager, [...after.keys(), ...changes.keys()]),
  );

  const changeId = randomUUID();
  const byFleet = new Map(
    placements.map(placement => [placement.fleetId, placement]),
  );
  const ended = [...changes.keys()]
    .map(fleetId => byFleet.get(fleetId))
    .filter(
      (placement): placement is ArmadaFleetMembershipEntity => !!placement,
    );

  if (ended.length > 0) {
    await manager.update(
      ArmadaFleetMembershipEntity,
      { id: In(ended.map(placement => placement.id)) },
      { validTo: context.now },
    );
  }

  const started = new Map<string, ArmadaFleetMembershipEntity>();
  const order = [
    ArmadaPosition.ALPHA,
    ArmadaPosition.BETA,
    ArmadaPosition.GAMMA,
  ];
  const placing = [...changes.entries()]
    .filter(([, change]) => change.slot !== null)
    .sort(
      ([, a], [, b]) =>
        order.indexOf((a.slot as ArmadaSlot).position) -
        order.indexOf((b.slot as ArmadaSlot).position),
    );

  for (const [fleetId, change] of placing) {
    const slot = change.slot as ArmadaSlot;
    const parent =
      slot.parentFleetId === null
        ? null
        : (started.get(slot.parentFleetId) ??
          (byFleet.get(slot.parentFleetId) as ArmadaFleetMembershipEntity));

    started.set(
      fleetId,
      await manager.save(
        ArmadaFleetMembershipEntity,
        manager.create(ArmadaFleetMembershipEntity, {
          communityId: armada.communityId,
          armadaId: armada.id,
          fleetId,
          position: slot.position,
          parentMembershipId: parent?.id ?? null,
          validFrom: context.now,
          reason: context.reason,
          recordedAt: context.now,
          recordedByUserId: context.actorUserId,
        }),
      ),
    );
  }

  await manager.insert(
    ArmadaActionEntity,
    [...changes.entries()].map(([fleetId, change]) => {
      const from = before.get(fleetId) ?? null;

      return {
        communityId: armada.communityId,
        armadaId: armada.id,
        fleetId,
        changeId,
        action: change.action,
        fromPosition: from?.position ?? null,
        fromParentFleetId: from?.parentFleetId ?? null,
        toPosition: change.slot?.position ?? null,
        toParentFleetId: change.slot?.parentFleetId ?? null,
        actorUserId: context.actorUserId,
        reason: context.reason,
        requestId:
          change.action === ArmadaActionKind.PLACED
            ? (context.requestId ?? null)
            : null,
        createdAt: context.now,
      };
    }),
  );

  await recordActivity(
    manager,
    [...changes.entries()].flatMap(([fleetId, change]) =>
      armadaActivity(armada, fleetId, change, before.get(fleetId) ?? null, {
        changeId,
        ...context,
      }),
    ),
  );

  await manager.increment(StoArmadaEntity, { id: armada.id }, 'revision', 1);
  await endIneligibleArmadaRoles(
    manager,
    armada,
    context.actorUserId,
    context.now,
  );

  return started;
}

/** Which Armada changes go on an activity feed, and as what. */
const ARMADA_ACTIVITY: Partial<Record<ArmadaActionKind, ActivityType>> = {
  [ArmadaActionKind.PLACED]: ActivityType.ARMADA_FLEET_PLACED,
  [ArmadaActionKind.MOVED]: ActivityType.ARMADA_FLEET_MOVED,
  [ArmadaActionKind.LEFT]: ActivityType.ARMADA_FLEET_LEFT,
  [ArmadaActionKind.REMOVED]: ActivityType.ARMADA_FLEET_LEFT,
};

/**
 * What one Fleet's change puts on the Armada's activity feed and the
 * Fleet's own (FC-029). An Armada closing is its own item, so the Fleets it
 * lets go add none.
 *
 * @param armada - The Armada.
 * @param fleetId - The Fleet.
 * @param change - What happens to it.
 * @param from - Where it sat before, if it was placed.
 * @param context - Who, when, and the change it is part of.
 * @returns An item for each feed, or none.
 */
function armadaActivity(
  armada: StoArmadaEntity,
  fleetId: string,
  change: ArmadaChange,
  from: ArmadaSlot | null,
  context: ArmadaChangeContext & { readonly changeId: string },
): ActivityRecord[] {
  const type = ARMADA_ACTIVITY[change.action];

  if (type === undefined) {
    return [];
  }

  const item = {
    communityId: armada.communityId,
    type,
    actorUserId: context.actorUserId,
    sourceId: armada.id,
    detail: {
      fleetId,
      armadaId: armada.id,
      from: from?.position ?? null,
      to: change.slot?.position ?? null,
    },
    occurredAt: context.now,
  };
  const key = `${type}:${context.changeId}:${fleetId}`;

  return [
    { ...item, armadaId: armada.id, idempotencyKey: `${key}:ARMADA` },
    { ...item, fleetId, idempotencyKey: `${key}:FLEET` },
  ];
}

/**
 * Ends the Armada roles and personal grants of anybody who is no longer an
 * approved member of a Fleet placed in it (FC-025).
 *
 * An Armada role is for its Fleets' members, so a Fleet leaving takes its
 * members' roles with it, unless they also belong to another Fleet still
 * placed there. Each role ended is logged, with the reason.
 *
 * @param manager - The transaction.
 * @param armada - The Armada.
 * @param actorUserId - Who made the change that ended them.
 * @param now - When.
 */
export async function endIneligibleArmadaRoles(
  manager: EntityManager,
  armada: Pick<StoArmadaEntity, 'id' | 'communityId'>,
  actorUserId: string | null,
  now: Date,
): Promise<void> {
  const eligible = await armadaMemberIds(manager, armada.id);
  const open = {
    communityId: armada.communityId,
    armadaId: armada.id,
    validTo: IsNull(),
    deletedAt: IsNull(),
  };
  const roles = await manager.find(ScopeRoleAssignmentEntity, {
    where:
      eligible.length === 0 ? open : { ...open, userId: Not(In(eligible)) },
  });

  for (const role of roles) {
    await manager.update(
      ScopeRoleAssignmentEntity,
      { id: role.id },
      { validTo: now },
    );
    await manager.insert(ScopeGovernanceActionEntity, {
      communityId: armada.communityId,
      armadaId: armada.id,
      action: ScopeGovernanceActionKind.ROLE_WITHDRAWN,
      actorUserId,
      subjectUserId: role.userId,
      role: role.role,
      reason: ARMADA_ROLE_ENDED_REASON,
    });
  }

  // Each grant that goes is logged too (FC-039).
  await endAndLog(
    manager,
    {
      grants: {
        communityId: armada.communityId,
        armadaId: armada.id,
        deletedAt: IsNull(),
        subjectUserId:
          eligible.length === 0 ? Not(IsNull()) : Not(In(eligible)),
      },
    },
    ARMADA_ROLE_ENDED_REASON,
    now,
  );
}

/**
 * Who counts as an Armada's member: the approved members of the Fleets
 * placed in it now.
 *
 * @param manager - The manager.
 * @param armadaId - The Armada.
 * @returns Their user IDs, each once.
 */
export async function armadaMemberIds(
  manager: EntityManager,
  armadaId: string,
): Promise<string[]> {
  const placed = (await openPlacements(manager, armadaId)).map(
    placement => placement.fleetId,
  );

  if (placed.length === 0) {
    return [];
  }

  const memberships = await manager.find(ScopeMembershipEntity, {
    where: {
      fleetId: In(placed),
      status: ScopeMembershipStatus.APPROVED,
      deletedAt: IsNull(),
    },
    select: { userId: true },
  });

  return [...new Set(memberships.map(membership => membership.userId))];
}

/**
 * Reads Fleets' names, for explaining a refusal.
 *
 * @param manager - The manager.
 * @param fleetIds - The Fleets.
 * @returns A function naming one.
 */
async function fleetNamer(
  manager: EntityManager,
  fleetIds: readonly string[],
): Promise<(fleetId: string) => string> {
  const fleets =
    fleetIds.length === 0
      ? []
      : await manager.find(StoFleetEntity, {
          where: { id: In([...new Set(fleetIds)]) },
          select: { id: true, exactGameName: true },
        });
  const names = new Map(fleets.map(fleet => [fleet.id, fleet.exactGameName]));

  return fleetId => names.get(fleetId) ?? 'That Fleet';
}

/** The allegiances an Armada may have. Undecided is not one of them. */
export const ARMADA_ALLEGIANCES: readonly string[] = ['Federation', 'Klingon'];

/**
 * Requires an Armada's allegiance to be Federation or Klingon.
 *
 * @param manager - The manager.
 * @param factionId - The general faction chosen.
 * @throws BadRequestException for anything else, Undecided included.
 */
export async function assertArmadaAllegiance(
  manager: EntityManager,
  factionId: string,
): Promise<void> {
  const faction = await manager.findOne(GeneralFactionEntity, {
    where: { id: factionId },
  });

  if (!faction || !ARMADA_ALLEGIANCES.includes(faction.name)) {
    throw new BadRequestException('An Armada is Federation or Klingon.');
  }
}

/**
 * Reports whether a Fleet is placed in an Armada now.
 *
 * @param manager - The manager.
 * @param fleetId - The Fleet.
 * @returns Its open placement, or null.
 */
export function openPlacementOf(
  manager: EntityManager,
  fleetId: string,
): Promise<ArmadaFleetMembershipEntity | null> {
  return manager.findOne(ArmadaFleetMembershipEntity, {
    where: { fleetId, validTo: IsNull(), deletedAt: IsNull() },
  });
}

/**
 * Ends every placement in an Armada that is closing, and every open request
 * to it (FC-024). The history records each as ended by closure.
 *
 * @param manager - The closure's transaction, holding the Armada's lock.
 * @param armada - The Armada.
 * @param actorUserId - Who closed it.
 * @param now - When.
 */
export async function endArmadaForClosure(
  manager: EntityManager,
  armada: StoArmadaEntity,
  actorUserId: string | null,
  now: Date,
): Promise<void> {
  const placements = await openPlacements(manager, armada.id);

  if (placements.length > 0) {
    await applyArmadaChange(
      manager,
      armada,
      placements,
      new Map(
        placements.map(placement => [
          placement.fleetId,
          { slot: null, action: ArmadaActionKind.CLOSED },
        ]),
      ),
      { actorUserId, reason: null, now },
    );
  }

  await cancelOpenRequests(manager, { armadaId: armada.id }, now);
}

/**
 * Ends a closing Fleet's placement and any open request of its (FC-024).
 *
 * A Beta's Gammas become Betas where there is room, in the order they were
 * placed, and otherwise leave: Steve's decision of 28 September 2026. Each
 * is recorded as part of the same change, with the reason.
 *
 * @param manager - The closure's transaction.
 * @param fleet - The Fleet.
 * @param actorUserId - Who closed it.
 * @param now - When.
 */
export async function endFleetForClosure(
  manager: EntityManager,
  fleet: Pick<StoFleetEntity, 'id' | 'exactGameName'>,
  actorUserId: string | null,
  now: Date,
): Promise<void> {
  await cancelOpenRequests(manager, { fleetId: fleet.id }, now);

  const placement = await openPlacementOf(manager, fleet.id);

  if (placement === null) {
    return;
  }

  const armada = await lockArmada(
    manager,
    placement.communityId,
    placement.armadaId,
  );
  const placements = await openPlacements(manager, armada.id);
  const before = arrangementOf(placements);
  let betas = [...before.values()].filter(
    slot => slot.position === ArmadaPosition.BETA,
  ).length;
  const changes = new Map<string, ArmadaChange>([
    [fleet.id, { slot: null, action: ArmadaActionKind.CLOSED }],
  ]);

  if (before.get(fleet.id)?.position === ArmadaPosition.BETA) {
    betas -= 1;

    for (const gamma of placements) {
      if (before.get(gamma.fleetId)?.parentFleetId !== fleet.id) {
        continue;
      }

      if (betas < MAX_ARMADA_BETAS) {
        betas += 1;
        changes.set(gamma.fleetId, {
          slot: { position: ArmadaPosition.BETA, parentFleetId: null },
          action: ArmadaActionKind.MOVED,
        });
      } else {
        changes.set(gamma.fleetId, {
          slot: null,
          action: ArmadaActionKind.REMOVED,
        });
      }
    }
  }

  await applyArmadaChange(manager, armada, placements, changes, {
    actorUserId,
    reason: `${fleet.exactGameName} closed.`,
    now,
  });
}

/**
 * Cancels open requests, because the Armada or the Fleet has closed.
 *
 * @param manager - The transaction.
 * @param where - The Armada's or the Fleet's.
 * @param now - When.
 */
export async function cancelOpenRequests(
  manager: EntityManager,
  where: { readonly armadaId: string } | { readonly fleetId: string },
  now: Date,
): Promise<void> {
  await manager.update(
    ArmadaJoinRequestEntity,
    { ...where, status: ArmadaJoinRequestStatus.PENDING },
    { status: ArmadaJoinRequestStatus.CANCELLED, answeredAt: now },
  );
}
