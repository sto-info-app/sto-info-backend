import { BadRequestException } from '@nestjs/common';

import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { InMemoryManager, Row } from '../../../../test/in-memory-manager';
import { ScopeEventAttendanceEntity } from '../../events/entities/scope-event-attendance.entity';
import { ScopeEventOccurrenceEntity } from '../../events/entities/scope-event-occurrence.entity';
import { ScopeEventRsvpEntity } from '../../events/entities/scope-event-rsvp.entity';
import { ScopeEventEntity } from '../../events/entities/scope-event.entity';
import {
  OccurrenceStatus,
  RsvpResponse,
} from '../../events/enums/scope-event.enums';
import { FleetHoldingChangeEntity } from '../../holdings/entities/fleet-holding-change.entity';
import { FleetHoldingHistoryEntity } from '../../holdings/entities/fleet-holding-history.entity';
import { FleetHoldingTrackEntity } from '../../holdings/entities/fleet-holding-track.entity';
import { FleetHoldingTypeEntity } from '../../holdings/entities/fleet-holding-type.entity';
import { FleetApplicationEntity } from '../../recruitment/entities/fleet-application.entity';
import { FleetInvitationEntity } from '../../recruitment/entities/fleet-invitation.entity';
import { FleetApplicationRoute } from '../../recruitment/enums/fleet-application-route.enum';
import { FleetApplicationStatus } from '../../recruitment/enums/fleet-application-status.enum';
import { FleetInvitationStatus } from '../../recruitment/enums/fleet-invitation-status.enum';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';
import {
  FleetRecordReportContext,
  FleetRecordReportsService,
} from './fleet-record-reports.service';

const FLEET_ID = 'fleet-1';
const NOW = new Date('2026-09-28T12:00:00.000Z');
const FROM = new Date('2026-01-01T00:00:00.000Z');
const DAY = 86_400_000;

describe('FleetRecordReportsService', () => {
  let db: InMemoryManager;
  let service: FleetRecordReportsService;

  /**
   * Opens a report over this year so far.
   *
   * @param report - The report.
   * @param view - How much the viewer is shown.
   * @returns The context.
   */
  const context = (
    report: FleetReport,
    view = FleetReportView.FULL,
  ): FleetRecordReportContext =>
    service.open(
      FLEET_ID,
      report,
      view,
      { from: FROM.toISOString(), to: NOW.toISOString() },
      NOW,
    );

  beforeEach(() => {
    db = new InMemoryManager();
    service = new FleetRecordReportsService(db.asDataSource());
  });

  describe('the span', () => {
    it('reaches back twelve months to now unless asked', () => {
      expect(
        service.open(
          FLEET_ID,
          FleetReport.HOLDINGS,
          FleetReportView.FULL,
          {},
          NOW,
        ),
      ).toEqual({
        fleetId: FLEET_ID,
        from: new Date('2025-09-28T00:00:00.000Z'),
        to: NOW,
        header: {
          report: FleetReport.HOLDINGS,
          view: FleetReportView.FULL,
          range: { from: new Date('2025-09-28T00:00:00.000Z'), to: NOW },
          minimumCohort: 5,
        },
      });
    });

    it('reads the span asked for', () => {
      const opened = context(FleetReport.HOLDINGS);

      expect([opened.from, opened.to]).toEqual([FROM, NOW]);
    });

    it('takes now as the end when none is given', () => {
      jest.useFakeTimers({ now: NOW });

      const opened = service.open(
        FLEET_ID,
        FleetReport.HOLDINGS,
        FleetReportView.FULL,
        { from: FROM.toISOString() },
      );

      jest.useRealTimers();
      expect(opened.to).toEqual(NOW);
    });

    it('refuses a span that ends before it starts', () => {
      expect(() =>
        service.open(
          FLEET_ID,
          FleetReport.HOLDINGS,
          FleetReportView.FULL,
          { from: NOW.toISOString(), to: FROM.toISOString() },
          NOW,
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('attendance', () => {
    /**
     * Seeds an occurrence of the Fleet's event.
     *
     * @param id - Its ID.
     * @param startsAt - When it starts.
     * @param overrides - What else differs.
     */
    const occurrence = (
      id: string,
      startsAt: string,
      overrides: Row = {},
    ): void => {
      db.seed(ScopeEventOccurrenceEntity, [
        {
          id,
          eventId: 'event-1',
          startsAt: new Date(startsAt),
          status: OccurrenceStatus.SCHEDULED,
          ...overrides,
        },
      ]);
    };

    /**
     * Records people at an occurrence.
     *
     * @param occurrenceId - The occurrence.
     * @param came - Who came.
     * @param missed - Who did not.
     */
    const record = (
      occurrenceId: string,
      came: string[],
      missed: string[] = [],
    ): void => {
      db.seed(ScopeEventAttendanceEntity, [
        ...came.map(userId => ({ occurrenceId, userId, attended: true })),
        ...missed.map(userId => ({ occurrenceId, userId, attended: false })),
      ]);
    };

    beforeEach(() => {
      db.seed(ScopeEventEntity, [
        { id: 'event-1', fleetId: FLEET_ID, title: 'Refit night' },
        { id: 'elsewhere', fleetId: 'fleet-2', title: 'Not ours' },
      ]).seed(UserProfileEntity, [
        { userId: 'kira', username: 'Kira' },
        { userId: 'odo', username: 'Odo' },
      ]);
      occurrence('held', '2026-03-06T20:00:00Z');
      occurrence('quiet', '2026-03-13T20:00:00Z');
      occurrence('ahead', '2026-10-02T19:00:00Z');
      occurrence('off', '2026-03-20T20:00:00Z', {
        status: OccurrenceStatus.CANCELLED,
      });
      occurrence('before', '2025-12-01T20:00:00Z');
      db.seed(ScopeEventOccurrenceEntity, [
        {
          id: 'other',
          eventId: 'elsewhere',
          startsAt: new Date('2026-03-06T20:00:00Z'),
          status: OccurrenceStatus.SCHEDULED,
        },
      ]);
      db.seed(ScopeEventRsvpEntity, [
        {
          occurrenceId: 'held',
          userId: 'kira',
          response: RsvpResponse.GOING,
          waitlistedAt: null,
        },
        {
          occurrenceId: 'held',
          userId: 'odo',
          response: RsvpResponse.GOING,
          waitlistedAt: new Date(),
        },
        {
          occurrenceId: 'held',
          userId: 'quark',
          response: RsvpResponse.MAYBE,
          waitlistedAt: null,
        },
      ]);
    });

    it('shows its managers each started occurrence of its own events, and each person', async () => {
      record('held', ['kira', 'nameless'], ['odo']);
      record('before', ['kira']);

      const report = await service.attendance(
        context(FleetReport.ATTENDANCE),
        NOW,
      );

      expect(report.occurrences).toEqual([
        {
          occurrenceId: 'held',
          eventId: 'event-1',
          title: 'Refit night',
          startsAt: new Date('2026-03-06T20:00:00Z'),
          going: 1,
          attended: 2,
          absent: 1,
          rate: 0.67,
        },
        {
          occurrenceId: 'quiet',
          eventId: 'event-1',
          title: 'Refit night',
          startsAt: new Date('2026-03-13T20:00:00Z'),
          going: 0,
          attended: 0,
          absent: 0,
          rate: null,
        },
      ]);
      expect(report.totals).toEqual({
        occurrences: 2,
        attended: 2,
        absent: 1,
        rate: 0.67,
      });
      expect(report.members).toEqual([
        { username: 'Kira', attended: 1, absent: 0 },
        { username: null, attended: 1, absent: 0 },
        { username: 'Odo', attended: 0, absent: 1 },
      ]);
    });

    it('lists people who came as often by name, nobody named last', async () => {
      record('held', ['nameless', 'odo', 'kira', 'unnamed']);

      const report = await service.attendance(
        context(FleetReport.ATTENDANCE),
        NOW,
      );

      expect(report.members?.map(row => row.username)).toEqual([
        'Kira',
        'Odo',
        null,
        null,
      ]);
    });

    it('shows anybody else counts alone, hiding small ones', async () => {
      record('held', ['a', 'b', 'c', 'd', 'e', 'f'], ['g', 'h', 'i', 'j', 'k']);
      record('quiet', ['a', 'b'], ['g']);

      const report = await service.attendance(
        context(FleetReport.ATTENDANCE, FleetReportView.AGGREGATE),
        NOW,
      );

      expect(
        report.occurrences.map(row => [
          row.going,
          row.attended,
          row.absent,
          row.rate,
        ]),
      ).toEqual([
        [null, 6, 5, 0.55],
        [0, null, null, null],
      ]);
      expect(report.totals).toEqual({
        occurrences: 2,
        attended: 8,
        absent: 6,
        rate: 0.57,
      });
      expect(report.members).toBeNull();
    });

    it('reads nothing for a Fleet with no events', async () => {
      const report = await service.attendance(
        service.open(
          'fleet-9',
          FleetReport.ATTENDANCE,
          FleetReportView.FULL,
          {},
          NOW,
        ),
        NOW,
      );

      expect(report.occurrences).toEqual([]);
      expect(report.totals).toEqual({
        occurrences: 0,
        attended: 0,
        absent: 0,
        rate: null,
      });
      expect(report.members).toEqual([]);
    });

    it('reads nothing of a span still to come', async () => {
      const report = await service.attendance(
        service.open(
          FLEET_ID,
          FleetReport.ATTENDANCE,
          FleetReportView.FULL,
          { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' },
          NOW,
        ),
        NOW,
      );

      expect(report.occurrences).toEqual([]);
    });

    it('counts up to the span’s end when it is past', async () => {
      const report = await service.attendance(
        service.open(
          FLEET_ID,
          FleetReport.ATTENDANCE,
          FleetReportView.FULL,
          { from: FROM.toISOString(), to: '2026-03-10T00:00:00Z' },
          NOW,
        ),
      );

      expect(report.occurrences.map(row => row.occurrenceId)).toEqual(['held']);
    });
  });

  describe('recruitment', () => {
    /**
     * Seeds an application.
     *
     * @param submittedAt - When it was made.
     * @param status - How it turned out.
     * @param overrides - What else differs.
     */
    const application = (
      submittedAt: string,
      status: FleetApplicationStatus,
      overrides: Row = {},
    ): void => {
      const at = new Date(submittedAt);

      db.seed(FleetApplicationEntity, [
        {
          fleetId: FLEET_ID,
          route: FleetApplicationRoute.APPLICATION,
          status,
          submittedAt: at,
          decidedAt: null,
          ...overrides,
        },
      ]);
    };

    /**
     * Seeds an invitation.
     *
     * @param createdAt - When it was sent.
     * @param status - How it turned out.
     * @param overrides - What else differs.
     */
    const invitation = (
      createdAt: string,
      status: FleetInvitationStatus,
      overrides: Row = {},
    ): void => {
      db.seed(FleetInvitationEntity, [
        {
          fleetId: FLEET_ID,
          status,
          createdAt: new Date(createdAt),
          answeredAt: null,
          expiresAt: new Date('2027-01-01T00:00:00Z'),
          ...overrides,
        },
      ]);
    };

    /**
     * A decision some days after asking.
     *
     * @param asked - When it was asked.
     * @param days - How many days later.
     * @returns The instant.
     */
    const after = (asked: string, days: number): Date =>
      new Date(new Date(asked).getTime() + days * DAY);

    beforeEach(() => {
      const march = '2026-03-02T10:00:00Z';

      application(march, FleetApplicationStatus.ACCEPTED, {
        decidedAt: after(march, 1),
      });
      application(march, FleetApplicationStatus.REJECTED, {
        decidedAt: after(march, 4),
      });
      application(march, FleetApplicationStatus.ACCEPTED, {
        decidedAt: null,
      });
      application(march, FleetApplicationStatus.WITHDRAWN);
      application(march, FleetApplicationStatus.PENDING);
      application('2026-02-10T10:00:00Z', FleetApplicationStatus.ACCEPTED, {
        route: FleetApplicationRoute.OPEN_JOIN,
        decidedAt: new Date('2026-02-10T10:00:00Z'),
      });
      application('2026-02-10T10:00:00Z', FleetApplicationStatus.ACCEPTED, {
        route: FleetApplicationRoute.INVITATION,
      });
      application('2025-06-01T10:00:00Z', FleetApplicationStatus.ACCEPTED);
      invitation(march, FleetInvitationStatus.ACCEPTED, {
        answeredAt: after(march, 2),
      });
      invitation(march, FleetInvitationStatus.DECLINED, {
        answeredAt: after(march, 3),
      });
      invitation(march, FleetInvitationStatus.WITHDRAWN);
      invitation(march, FleetInvitationStatus.LAPSED);
      invitation(march, FleetInvitationStatus.PENDING);
      invitation(march, FleetInvitationStatus.PENDING, {
        expiresAt: new Date('2026-03-09T10:00:00Z'),
      });
    });

    it('counts each month and route, in order, with the median days to a decision', async () => {
      const report = await service.recruitment(
        context(FleetReport.RECRUITMENT),
        NOW,
      );

      expect(report.months).toEqual([
        {
          month: '2026-02',
          route: FleetApplicationRoute.OPEN_JOIN,
          received: 1,
          accepted: 1,
          declined: 0,
          withdrawn: 0,
          lapsed: 0,
          pending: 0,
          medianDaysToDecision: 0,
        },
        {
          month: '2026-03',
          route: FleetApplicationRoute.APPLICATION,
          received: 5,
          accepted: 2,
          declined: 1,
          withdrawn: 1,
          lapsed: 0,
          pending: 1,
          medianDaysToDecision: 1,
        },
        {
          month: '2026-03',
          route: FleetApplicationRoute.INVITATION,
          received: 6,
          accepted: 1,
          declined: 1,
          withdrawn: 1,
          lapsed: 2,
          pending: 1,
          medianDaysToDecision: 2.5,
        },
      ]);
    });

    it('hides small counts, and a median of fewer than five, from anybody else', async () => {
      // Read now: the invitations still pending have not yet run out.
      const report = await service.recruitment(
        context(FleetReport.RECRUITMENT, FleetReportView.AGGREGATE),
      );

      expect(report.months[1]).toEqual(
        expect.objectContaining({
          received: 5,
          accepted: null,
          medianDaysToDecision: null,
        }),
      );
    });

    it('gives the median of five or more to anybody it is shown to', async () => {
      const march = '2026-03-02T10:00:00Z';

      for (const days of [1, 2, 3]) {
        application(march, FleetApplicationStatus.ACCEPTED, {
          decidedAt: after(march, days),
        });
      }

      const report = await service.recruitment(
        context(FleetReport.RECRUITMENT, FleetReportView.AGGREGATE),
        NOW,
      );

      expect(report.months[1].medianDaysToDecision).toBe(1.5);
    });
  });

  describe('holdings', () => {
    beforeEach(() => {
      db.seed(FleetHoldingTypeEntity, [{ code: 'STARBASE', name: 'Starbase' }])
        .seed(FleetHoldingTrackEntity, [
          { code: 'SB_MILITARY', name: 'Military', position: 2 },
          { code: 'SB_ENGINEERING', name: 'Engineering', position: 1 },
        ])
        .seed(FleetHoldingChangeEntity, [
          {
            id: 'older',
            fleetId: FLEET_ID,
            holdingTypeCode: 'STARBASE',
            createdAt: new Date('2026-02-01T00:00:00Z'),
          },
          {
            id: 'newer',
            fleetId: FLEET_ID,
            holdingTypeCode: 'GONE',
            createdAt: new Date('2026-03-01T00:00:00Z'),
          },
          {
            id: 'long-ago',
            fleetId: FLEET_ID,
            holdingTypeCode: 'STARBASE',
            createdAt: new Date('2025-01-01T00:00:00Z'),
          },
        ])
        .seed(FleetHoldingHistoryEntity, [
          {
            changeId: 'older',
            trackCode: 'SB_MILITARY',
            tierBefore: 1,
            tier: 2,
          },
          {
            changeId: 'older',
            trackCode: 'SB_ENGINEERING',
            tierBefore: 0,
            tier: 1,
          },
          {
            changeId: 'newer',
            trackCode: 'SB_MILITARY',
            tierBefore: 3,
            tier: 4,
          },
          { changeId: 'newer', trackCode: 'RETIRED', tierBefore: 2, tier: 3 },
          {
            changeId: 'long-ago',
            trackCode: 'SB_MILITARY',
            tierBefore: 0,
            tier: 1,
          },
        ]);
    });

    it('lists every tier moved in the span, newest first, in track order', async () => {
      const report = await service.holdings(context(FleetReport.HOLDINGS));

      expect(report.changes).toEqual([
        {
          at: new Date('2026-03-01T00:00:00Z'),
          holding: 'GONE',
          track: 'RETIRED',
          from: 2,
          to: 3,
        },
        {
          at: new Date('2026-03-01T00:00:00Z'),
          holding: 'GONE',
          track: 'Military',
          from: 3,
          to: 4,
        },
        {
          at: new Date('2026-02-01T00:00:00Z'),
          holding: 'Starbase',
          track: 'Engineering',
          from: 0,
          to: 1,
        },
        {
          at: new Date('2026-02-01T00:00:00Z'),
          holding: 'Starbase',
          track: 'Military',
          from: 1,
          to: 2,
        },
      ]);
    });

    it('reads nothing more for a span with no change', async () => {
      const find = jest.spyOn(db, 'find');

      const report = await service.holdings(
        service.open(
          'fleet-9',
          FleetReport.HOLDINGS,
          FleetReportView.FULL,
          {},
          NOW,
        ),
      );

      expect(report.changes).toEqual([]);
      expect(find).toHaveBeenCalledTimes(1);
    });
  });
});
