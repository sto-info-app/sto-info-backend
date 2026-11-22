import { ConflictException, NotFoundException } from '@nestjs/common';

import { EntityManager, IsNull } from 'typeorm';

import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { GovernanceScope } from '../../governance/utilities/governance-scope.utility';
import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventEntity } from '../entities/scope-event.entity';
import { OccurrenceStatus, ScopeEventStatus } from '../enums/scope-event.enums';
import { EventViewer } from '../services/scope-event-access.service';

/** How each kind of scope is named in a sentence. */
const SCOPE_NOUNS: Readonly<Record<FleetScopeKind, string>> = {
  [FleetScopeKind.COMMUNITY]: 'Community',
  [FleetScopeKind.FLEET]: 'Fleet',
  [FleetScopeKind.ARMADA]: 'Armada',
};

/**
 * Finds an event of exactly this scope: a Community's own, not its Fleets'.
 *
 * @param manager - The manager to read through.
 * @param scope - The scope in the path.
 * @param eventId - The event.
 * @param lock - Whether to hold it for the rest of the transaction.
 * @returns The event.
 * @throws NotFoundException when this scope has no such event.
 */
export async function findEventInScope(
  manager: EntityManager,
  scope: GovernanceScope,
  eventId: string,
  lock = false,
): Promise<ScopeEventEntity> {
  const event = await manager.findOne(ScopeEventEntity, {
    where: {
      id: eventId,
      communityId: scope.communityId,
      fleetId: scope.fleetId ?? IsNull(),
      armadaId: scope.armadaId ?? IsNull(),
    },
    ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
  });

  if (event === null) {
    throw new NotFoundException('Not found');
  }

  return event;
}

/**
 * Finds one of an event's occurrences.
 *
 * @param manager - The manager to read through.
 * @param eventId - The event.
 * @param occurrenceId - The occurrence.
 * @param lock - Whether to hold it for the rest of the transaction, which is
 *   how every answer to it is taken one at a time.
 * @returns The occurrence.
 * @throws NotFoundException when the event has no such occurrence.
 */
export async function findOccurrenceOf(
  manager: EntityManager,
  eventId: string,
  occurrenceId: string,
  lock = false,
): Promise<ScopeEventOccurrenceEntity> {
  const occurrence = await manager.findOne(ScopeEventOccurrenceEntity, {
    where: { id: occurrenceId, eventId },
    ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
  });

  if (occurrence === null) {
    throw new NotFoundException('Not found');
  }

  return occurrence;
}

/**
 * Requires that a scope's events may change.
 *
 * @param scope - The scope.
 * @param viewer - Who is changing them.
 * @throws ConflictException when the scope is closed or suspended.
 */
export function assertScopeOpen(
  scope: GovernanceScope,
  viewer: EventViewer,
): void {
  if (!viewer.isOpen) {
    throw new ConflictException(
      `This ${SCOPE_NOUNS[scope.kind]} is closed or suspended, so its events cannot change.`,
    );
  }
}

/**
 * Requires that an event is still running.
 *
 * @param event - The event.
 * @throws ConflictException when it was cancelled.
 */
export function assertEventActive(event: ScopeEventEntity): void {
  if (event.status !== ScopeEventStatus.ACTIVE) {
    throw new ConflictException('This event was cancelled.');
  }
}

/**
 * Requires that an occurrence still lies ahead and is going ahead.
 *
 * @param occurrence - The occurrence.
 * @param now - The moment of the change.
 * @param started - What to say when it has started.
 * @throws ConflictException when it was cancelled or has started.
 */
export function assertOccurrenceAhead(
  occurrence: ScopeEventOccurrenceEntity,
  now: Date,
  started: string,
): void {
  if (occurrence.status !== OccurrenceStatus.SCHEDULED) {
    throw new ConflictException('This occurrence was cancelled.');
  }

  if (occurrence.startsAt <= now) {
    throw new ConflictException(started);
  }
}
