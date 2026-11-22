import { jest } from '@jest/globals';

import { FleetAudienceService } from 'src/fleet/authorisation/fleet-audience.service';
import { FleetAuthorisationService } from 'src/fleet/authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from 'src/fleet/authorisation/fleet-capability.constants';
import { ScopeRef } from 'src/fleet/authorisation/scope-authorisation.interface';
import { FleetCommunityEntity } from 'src/fleet/entities/fleet-community.entity';
import { FleetAudience } from 'src/fleet/enums/fleet-audience.enum';
import { FleetScopeRole } from 'src/fleet/enums/fleet-scope-role.enum';
import { FleetScopeStatus } from 'src/fleet/enums/fleet-scope-status.enum';
import { ScopeEventEntity } from 'src/fleet/events/entities/scope-event.entity';
import { EventRecurrence } from 'src/fleet/events/enums/event-recurrence.enum';
import {
  ScopeEventAudience,
  ScopeEventStatus,
} from 'src/fleet/events/enums/scope-event.enums';
import { ScopeEventAccessService } from 'src/fleet/events/services/scope-event-access.service';
import { ScopeEventAttendanceService } from 'src/fleet/events/services/scope-event-attendance.service';
import { ScopeEventReadService } from 'src/fleet/events/services/scope-event-read.service';
import { ScopeEventReminderService } from 'src/fleet/events/services/scope-event-reminder.service';
import { ScopeEventRsvpService } from 'src/fleet/events/services/scope-event-rsvp.service';
import { ScopeEventService } from 'src/fleet/events/services/scope-event.service';
import {
  communityScope,
  fleetScope,
} from 'src/fleet/governance/utilities/governance-scope.utility';
import { CharacterFleetMembershipService } from 'src/fleet/services/character-fleet-membership.service';
import { NotificationOutboxRegistry } from 'src/notification/outbox/notification-outbox.registry';

import { InMemoryManager, Row } from './in-memory-manager';

/**
 * A world for the event services (FC-028): the real services, over rows in
 * an {@link InMemoryManager}, with the authorisation policy answered per
 * person. It lives under `test/` so it is not measured for coverage.
 */

export const COMMUNITY_ID = '28000000-0000-4000-8000-000000000001';
export const FLEET_ID = '28000000-0000-4000-8000-000000000002';
export const OTHER_FLEET_ID = '28000000-0000-4000-8000-000000000003';
export const ARMADA_ID = '28000000-0000-4000-8000-000000000004';
export const MANAGER_ID = '28000000-0000-4000-8000-000000000010';
export const MEMBER_ID = '28000000-0000-4000-8000-000000000011';
export const OTHER_MEMBER_ID = '28000000-0000-4000-8000-000000000012';
export const STRANGER_ID = '28000000-0000-4000-8000-000000000013';

export const FLEET = fleetScope(COMMUNITY_ID, FLEET_ID);
export const COMMUNITY = communityScope(COMMUNITY_ID);

/** Who somebody is at the scope. */
export interface Standing {
  readonly capabilities?: string[];
  readonly roles?: FleetScopeRole[];
  /** The audiences they are in at the scope. */
  readonly audiences?: FleetAudience[];
  /** Whether they may see the scope at all. */
  readonly seesScope?: boolean;
}

/** A member: may answer, sees names, in the Community and the Fleet. */
export const MEMBER: Standing = {
  capabilities: [FLEET_CAPABILITIES.EVENTS_RSVP],
  roles: [FleetScopeRole.MEMBER],
  audiences: [FleetAudience.COMMUNITY, FleetAudience.FLEET_MEMBERS],
};

/** An event manager: an Admin holding everything. */
export const MANAGER: Standing = {
  capabilities: [
    FLEET_CAPABILITIES.EVENTS_MANAGE,
    FLEET_CAPABILITIES.EVENTS_RSVP,
  ],
  roles: [FleetScopeRole.ADMIN],
  audiences: [FleetAudience.COMMUNITY, FleetAudience.FLEET_MEMBERS],
};

/** A mocked asynchronous call whose answer a spec may set. */
type AsyncMock = jest.Mock<(...args: any[]) => Promise<any>>;

/** The world's parts. */
export interface EventsWorld {
  readonly db: InMemoryManager;
  readonly standings: Map<string | null, Standing>;
  /** The scope's effective status, for everybody. */
  status: FleetScopeStatus;
  readonly access: ScopeEventAccessService;
  readonly rsvps: ScopeEventRsvpService;
  readonly events: ScopeEventService;
  readonly reads: ScopeEventReadService;
  readonly attendance: ScopeEventAttendanceService;
  readonly reminders: ScopeEventReminderService;
  readonly characters: { requireOwnedCharacter: AsyncMock };
  readonly registry: NotificationOutboxRegistry;
  readonly query: AsyncMock;
}

/**
 * Builds the world, with the Community seeded.
 *
 * @returns The world.
 */
export function eventsWorld(): EventsWorld {
  const db = new InMemoryManager().seed(FleetCommunityEntity, [
    {
      id: COMMUNITY_ID,
      name: 'Fixture Community',
      slug: 'fixture-community',
      preferredTimezone: 'Europe/London',
    },
  ]);
  const standings = new Map<string | null, Standing>([
    [MANAGER_ID, MANAGER],
    [MEMBER_ID, MEMBER],
    [OTHER_MEMBER_ID, MEMBER],
    [STRANGER_ID, {}],
    [null, {}],
  ]);
  const standingOf = (userId: string | null): Standing =>
    standings.get(userId) ?? {};
  const world = { status: FleetScopeStatus.ACTIVE } as EventsWorld;
  const authorisation = {
    authorise: jest.fn(async (userId: string | null, ref: ScopeRef) => ({
      scope: { effectiveStatus: world.status, id: ref.id },
      userId,
      roles: new Set(standingOf(userId).roles ?? []),
      capabilities: new Set(standingOf(userId).capabilities ?? []),
      isApprovedMember: false,
      isSuspended: false,
    })),
  };
  const audience = {
    canViewScope: jest.fn(
      async (_ref: ScopeRef, userId: string | null) =>
        standingOf(userId).seesScope ?? true,
    ),
    canView: jest.fn(
      async (wanted: FleetAudience, _ref: ScopeRef, userId: string | null) =>
        wanted === FleetAudience.PUBLIC ||
        (standingOf(userId).audiences ?? []).includes(wanted),
    ),
  };
  const characters = {
    requireOwnedCharacter: jest.fn(
      async (_manager: unknown, characterId: string, userId: string) => {
        if (characterId !== `character-of-${userId}`) {
          throw new Error('Not theirs');
        }
      },
    ),
  };
  const registry = new NotificationOutboxRegistry();
  const query = jest.fn(async () => []);
  const dataSource = Object.assign(db.asDataSource(), { query });
  const access = new ScopeEventAccessService(
    dataSource,
    authorisation as unknown as FleetAuthorisationService,
    audience as unknown as FleetAudienceService,
  );
  const rsvps = new ScopeEventRsvpService(
    dataSource,
    access,
    characters as unknown as CharacterFleetMembershipService,
  );

  return Object.assign(world, {
    db,
    standings,
    access,
    rsvps,
    events: new ScopeEventService(dataSource, access, rsvps),
    reads: new ScopeEventReadService(dataSource, access, rsvps),
    attendance: new ScopeEventAttendanceService(dataSource, access, rsvps),
    reminders: new ScopeEventReminderService(dataSource, access, registry),
    characters,
    registry,
    query,
  });
}

/**
 * Seeds an event directly, as a row, for specs about what happens to one.
 *
 * @param db - The manager.
 * @param overrides - What differs from a one-off Fleet event.
 * @returns The row.
 */
export function seedEvent(
  db: InMemoryManager,
  overrides: Partial<ScopeEventEntity> = {},
): ScopeEventEntity {
  const row = {
    id: '28000000-0000-4000-8000-0000000000e1',
    communityId: COMMUNITY_ID,
    fleetId: FLEET_ID,
    armadaId: null,
    title: 'Refit night',
    description: '',
    externalUrl: null,
    audience: ScopeEventAudience.PUBLIC,
    timezone: 'Europe/London',
    recurrence: EventRecurrence.NONE,
    startDate: '2030-01-04',
    startTime: '20:00',
    interval: 1,
    weekdays: [],
    monthDay: null,
    monthWeek: null,
    monthWeekday: null,
    endsOn: null,
    occurrenceLimit: null,
    durationMinutes: 120,
    capacity: null,
    status: ScopeEventStatus.ACTIVE,
    cancelledAt: null,
    materialisedThrough: '2031-01-04',
    createdByUserId: MANAGER_ID,
    createdAt: new Date('2029-12-01T00:00:00Z'),
    updatedAt: new Date('2029-12-01T00:00:00Z'),
    ...overrides,
  } as ScopeEventEntity;

  db.seed(ScopeEventEntity, [row as unknown as Row]);

  return row;
}
