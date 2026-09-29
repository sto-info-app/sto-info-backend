import { PATH_METADATA } from '@nestjs/common/constants';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { REQUIRES_SCOPE_CAPABILITY_KEY } from '../authorisation/requires-scope-capability.decorator';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from '../governance/utilities/governance-scope.utility';
import { ScopeEventDefinitionDto } from './dto/scope-event.dto';
import { EventRecurrence } from './enums/event-recurrence.enum';
import { RsvpResponse, ScopeEventAudience } from './enums/scope-event.enums';
import {
  ArmadaEventsController,
  CommunityEventsController,
  FleetEventsController,
  PersonalEventsController,
} from './scope-events.controllers';
import { ScopeEventAttendanceService } from './services/scope-event-attendance.service';
import { ScopeEventReadService } from './services/scope-event-read.service';
import { ScopeEventReminderService } from './services/scope-event-reminder.service';
import { ScopeEventRsvpService } from './services/scope-event-rsvp.service';
import { ScopeEventService } from './services/scope-event.service';

const COMMUNITY_ID = '28000000-0000-4000-8000-000000000001';
const SCOPE_ID = '28000000-0000-4000-8000-000000000002';
const EVENT_ID = '28000000-0000-4000-8000-000000000003';
const OCCURRENCE_ID = '28000000-0000-4000-8000-000000000004';
const USER_ID = '28000000-0000-4000-8000-000000000005';

const DEFINITION: ScopeEventDefinitionDto = {
  title: 'Refit night',
  audience: ScopeEventAudience.PUBLIC,
  recurrence: EventRecurrence.NONE,
  startDate: '2030-01-04',
  startTime: '20:00',
  durationMinutes: 60,
};

/** The routes that change an event, each needing events.manage. */
const MANAGING_ROUTES = [
  'preview',
  'create',
  'update',
  'cancel',
  'cancelOccurrence',
  'moveOccurrence',
  'recordAttendance',
] as const;

/** The routes open to anybody who may see the event. */
const READING_ROUTES = ['calendar', 'detail', 'occurrence'] as const;

const CASES = [
  {
    name: 'CommunityEventsController',
    type: CommunityEventsController,
    path: 'fleet-communities/:communityId/events',
    source: { kind: FleetScopeKind.COMMUNITY, param: 'communityId' },
    scope: communityScope(COMMUNITY_ID),
    id: COMMUNITY_ID,
  },
  {
    name: 'FleetEventsController',
    type: FleetEventsController,
    path: 'fleet-communities/:communityId/fleets/:fleetId/events',
    source: {
      kind: FleetScopeKind.FLEET,
      param: 'fleetId',
      communityParam: 'communityId',
    },
    scope: fleetScope(COMMUNITY_ID, SCOPE_ID),
    id: SCOPE_ID,
  },
  {
    name: 'ArmadaEventsController',
    type: ArmadaEventsController,
    path: 'fleet-communities/:communityId/armadas/:armadaId/events',
    source: {
      kind: FleetScopeKind.ARMADA,
      param: 'armadaId',
      communityParam: 'communityId',
    },
    scope: armadaScope(COMMUNITY_ID, SCOPE_ID),
    id: SCOPE_ID,
  },
];

type Controller = InstanceType<typeof FleetEventsController>;
type Mocked = Record<
  string,
  jest.Mock<(...args: unknown[]) => Promise<unknown>>
>;

/**
 * Builds a service stand-in answering each method with its own name.
 *
 * @param methods - The methods.
 * @returns The stand-in.
 */
function stub(methods: string[]): Mocked {
  return Object.fromEntries(
    methods.map(method => [method, jest.fn(async () => method)]),
  );
}

describe.each(CASES)('$name', ({ name, type, path, source, scope, id }) => {
  let feature: { assertEnabled: jest.Mock<() => Promise<void>> };
  let events: Mocked;
  let reads: Mocked;
  let rsvps: Mocked;
  let attendance: Mocked;
  let reminders: Mocked;
  let controller: Controller;

  beforeEach(() => {
    feature = { assertEnabled: jest.fn(async () => undefined) };
    events = stub([
      'preview',
      'create',
      'update',
      'cancel',
      'cancelOccurrence',
      'moveOccurrence',
    ]);
    events.create.mockResolvedValue({ id: EVENT_ID });
    reads = stub(['calendar', 'detail', 'occurrence', 'history', 'attendance']);
    rsvps = stub(['answer', 'withdraw']);
    attendance = stub(['record']);
    reminders = stub(['subscribe', 'unsubscribe']);
    controller = new type(
      feature as unknown as FleetFeatureService,
      events as unknown as ScopeEventService,
      reads as unknown as ScopeEventReadService,
      rsvps as unknown as ScopeEventRsvpService,
      attendance as unknown as ScopeEventAttendanceService,
      reminders as unknown as ScopeEventReminderService,
    ) as Controller;
  });

  afterEach(() => {
    const services = [events, reads, rsvps, attendance, reminders];

    // Every route that reached a service asked whether the feature is on.
    if (
      services.some(service =>
        Object.values(service).some(method => method.mock.calls.length > 0),
      )
    ) {
      expect(feature.assertEnabled).toHaveBeenCalled();
    }
  });

  it('is a controller of its own name, at its own address', () => {
    expect(type.name).toBe(name);
    expect(Reflect.getMetadata(PATH_METADATA, type)).toBe(path);
  });

  it.each(MANAGING_ROUTES)('keeps %s to events.manage holders', route => {
    expect(
      Reflect.getMetadata(REQUIRES_SCOPE_CAPABILITY_KEY, type.prototype[route]),
    ).toEqual({ capability: FLEET_CAPABILITIES.EVENTS_MANAGE, source });
  });

  it.each(READING_ROUTES)('leaves %s open to whoever may see it', route => {
    expect(
      Reflect.getMetadata(REQUIRES_SCOPE_CAPABILITY_KEY, type.prototype[route]),
    ).toBeUndefined();
  });

  it('reads the calendar, an event and an occurrence', async () => {
    const query = { from: '2030-01-01T00:00:00Z' };

    await expect(
      controller.calendar(COMMUNITY_ID, id, null, query),
    ).resolves.toBe('calendar');
    await expect(
      controller.detail(COMMUNITY_ID, id, EVENT_ID, USER_ID),
    ).resolves.toBe('detail');
    await expect(
      controller.occurrence(COMMUNITY_ID, id, EVENT_ID, OCCURRENCE_ID, null),
    ).resolves.toBe('occurrence');
    expect(reads.calendar).toHaveBeenCalledWith(scope, null, query);
    expect(reads.detail).toHaveBeenCalledWith(scope, EVENT_ID, USER_ID);
    expect(reads.occurrence).toHaveBeenCalledWith(
      scope,
      EVENT_ID,
      OCCURRENCE_ID,
      null,
    );
  });

  it('previews, creates and changes an event, answering with it', async () => {
    await expect(
      controller.preview(COMMUNITY_ID, id, DEFINITION, USER_ID),
    ).resolves.toBe('preview');
    await expect(
      controller.create(COMMUNITY_ID, id, DEFINITION, USER_ID),
    ).resolves.toBe('detail');
    await expect(
      controller.update(COMMUNITY_ID, id, EVENT_ID, DEFINITION, USER_ID),
    ).resolves.toBe('detail');
    expect(events.preview).toHaveBeenCalledWith(scope, DEFINITION, USER_ID);
    expect(events.create).toHaveBeenCalledWith(scope, DEFINITION, USER_ID);
    expect(events.update).toHaveBeenCalledWith(
      scope,
      EVENT_ID,
      DEFINITION,
      USER_ID,
    );
    expect(reads.detail).toHaveBeenCalledWith(scope, EVENT_ID, USER_ID);
  });

  it('cancels an event, and cancels and moves an occurrence', async () => {
    const move = { date: '2030-01-05', time: '19:00' };

    await controller.cancel(COMMUNITY_ID, id, EVENT_ID, USER_ID);
    await controller.cancelOccurrence(
      COMMUNITY_ID,
      id,
      EVENT_ID,
      OCCURRENCE_ID,
      USER_ID,
    );
    await controller.moveOccurrence(
      COMMUNITY_ID,
      id,
      EVENT_ID,
      OCCURRENCE_ID,
      move,
      USER_ID,
    );

    expect(events.cancel).toHaveBeenCalledWith(scope, EVENT_ID, USER_ID);
    expect(events.cancelOccurrence).toHaveBeenCalledWith(
      scope,
      EVENT_ID,
      OCCURRENCE_ID,
      USER_ID,
    );
    expect(events.moveOccurrence).toHaveBeenCalledWith(
      scope,
      EVENT_ID,
      OCCURRENCE_ID,
      move,
      USER_ID,
    );
  });

  it('reads the change log and who came', async () => {
    await expect(
      controller.history(COMMUNITY_ID, id, EVENT_ID, USER_ID),
    ).resolves.toBe('history');
    await expect(
      controller.attendance(COMMUNITY_ID, id, EVENT_ID, OCCURRENCE_ID, USER_ID),
    ).resolves.toBe('attendance');
    expect(reads.history).toHaveBeenCalledWith(scope, EVENT_ID, USER_ID);
    expect(reads.attendance).toHaveBeenCalledWith(
      scope,
      EVENT_ID,
      OCCURRENCE_ID,
      USER_ID,
    );
  });

  it('records who came', async () => {
    const dto = { userId: USER_ID, attended: true };

    await controller.recordAttendance(
      COMMUNITY_ID,
      id,
      EVENT_ID,
      OCCURRENCE_ID,
      dto,
      USER_ID,
    );

    expect(attendance.record).toHaveBeenCalledWith(
      scope,
      EVENT_ID,
      OCCURRENCE_ID,
      dto,
      USER_ID,
    );
  });

  it('takes and withdraws an answer', async () => {
    const dto = { response: RsvpResponse.GOING };

    await expect(
      controller.answer(
        COMMUNITY_ID,
        id,
        EVENT_ID,
        OCCURRENCE_ID,
        dto,
        USER_ID,
      ),
    ).resolves.toBe('answer');
    await controller.withdraw(
      COMMUNITY_ID,
      id,
      EVENT_ID,
      OCCURRENCE_ID,
      USER_ID,
    );

    expect(rsvps.answer).toHaveBeenCalledWith(
      scope,
      EVENT_ID,
      OCCURRENCE_ID,
      USER_ID,
      dto,
    );
    expect(rsvps.withdraw).toHaveBeenCalledWith(
      scope,
      EVENT_ID,
      OCCURRENCE_ID,
      USER_ID,
    );
  });

  it('takes and stops reminders', async () => {
    const dto = { leadMinutes: [60] };

    await expect(
      controller.subscribe(COMMUNITY_ID, id, EVENT_ID, dto, USER_ID),
    ).resolves.toBe('subscribe');
    await controller.unsubscribe(COMMUNITY_ID, id, EVENT_ID, USER_ID);

    expect(reminders.subscribe).toHaveBeenCalledWith(
      scope,
      EVENT_ID,
      USER_ID,
      dto,
    );
    expect(reminders.unsubscribe).toHaveBeenCalledWith(
      scope,
      EVENT_ID,
      USER_ID,
    );
  });
});

describe('PersonalEventsController', () => {
  let feature: { assertEnabled: jest.Mock<() => Promise<void>> };
  let reads: Mocked;
  let controller: PersonalEventsController;

  beforeEach(() => {
    feature = { assertEnabled: jest.fn(async () => undefined) };
    reads = stub(['upcomingFor']);
    controller = new PersonalEventsController(
      feature as unknown as FleetFeatureService,
      reads as unknown as ScopeEventReadService,
    );
  });

  it('reads the caller’s own upcoming events, once the feature is on', async () => {
    await expect(controller.mine(USER_ID)).resolves.toBe('upcomingFor');
    expect(feature.assertEnabled).toHaveBeenCalled();
    expect(reads.upcomingFor).toHaveBeenCalledWith(USER_ID);
  });

  it('reads nothing while the feature is off', async () => {
    feature.assertEnabled.mockRejectedValue(new Error('off'));

    await expect(controller.mine(USER_ID)).rejects.toThrow('off');
    expect(reads.upcomingFor).not.toHaveBeenCalled();
  });
});
