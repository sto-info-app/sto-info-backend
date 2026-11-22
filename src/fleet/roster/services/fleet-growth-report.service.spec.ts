import { FindOperator, Repository } from 'typeorm';

import { RosterIntervalSummaryEntity } from '../../projection/entities/roster-interval-summary.entity';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';
import { RosterActivityBand } from '../enums/roster-activity-band.enum';
import { FleetGrowthReportService } from './fleet-growth-report.service';
import { FleetReportContext } from './fleet-report-context.service';
import { FleetReportQueryService } from './fleet-report-query.service';

const NOV_1 = new Date('2024-11-01T12:00:00Z');
const NOV_15 = new Date('2024-11-15T12:00:00Z');
const DEC_1 = new Date('2024-12-01T12:00:00Z');

const EXPORTS = [
  { importId: 'import-1', exportedAt: NOV_1, partial: false },
  { importId: 'import-2', exportedAt: NOV_15, partial: true },
  { importId: 'import-3', exportedAt: DEC_1, partial: false },
];

/**
 * Opens a context over the three exports.
 *
 * @param view - How much the viewer is shown.
 * @param exports - The exports in the span.
 * @returns The context.
 */
function context(view: FleetReportView, exports = EXPORTS): FleetReportContext {
  return {
    fleetId: 'fleet-1',
    header: {
      report: FleetReport.GROWTH,
      view,
      revision: 4,
      publishedAt: null,
      stale: false,
      range: { from: null, to: null },
      coverage: { exports: exports.length, first: null, latest: null },
      minimumCohort: 5,
    },
    exports,
    first: EXPORTS[0],
    at: null,
  };
}

/**
 * Builds an interval summary.
 *
 * @param overrides - Fields to change.
 * @returns The summary.
 */
function interval(
  overrides: Partial<RosterIntervalSummaryEntity> = {},
): RosterIntervalSummaryEntity {
  return {
    fromImportId: 'import-1',
    fromAt: NOV_1,
    toImportId: 'import-2',
    toAt: NOV_15,
    partial: true,
    membersAtStart: 40,
    membersAtEnd: 42,
    joined: 6,
    rejoined: 0,
    left: 3,
    unknown: 9,
    acrossGap: 1,
    ...overrides,
  } as RosterIntervalSummaryEntity;
}

describe('FleetGrowthReportService', () => {
  let intervals: { find: jest.Mock };
  let queries: { accounts: jest.Mock; activity: jest.Mock };
  let service: FleetGrowthReportService;

  beforeEach(() => {
    intervals = {
      find: jest.fn(() =>
        Promise.resolve([
          interval(),
          interval({
            fromImportId: 'import-2',
            fromAt: NOV_15,
            toImportId: 'import-3',
            toAt: DEC_1,
            partial: false,
            membersAtStart: 42,
            membersAtEnd: 3,
            joined: 0,
            rejoined: 0,
            left: 39,
            unknown: 0,
            acrossGap: 0,
          }),
        ]),
      ),
    };
    queries = {
      accounts: jest.fn(() =>
        Promise.resolve([
          { importId: 'import-1', count: 31 },
          { importId: 'import-2', count: 33 },
        ]),
      ),
      activity: jest.fn(() =>
        Promise.resolve([
          {
            importId: 'import-1',
            band: RosterActivityBand.WITHIN_7_DAYS,
            count: 20,
          },
          {
            importId: 'import-1',
            band: RosterActivityBand.WITHIN_30_DAYS,
            count: 12,
          },
          {
            importId: 'import-1',
            band: RosterActivityBand.OVER_90_DAYS,
            count: 3,
          },
          { importId: 'import-1', band: RosterActivityBand.UNKNOWN, count: 5 },
        ]),
      ),
    };
    service = new FleetGrowthReportService(
      intervals as unknown as Repository<RosterIntervalSummaryEntity>,
      queries as unknown as FleetReportQueryService,
    );
  });

  describe('growth', () => {
    it('reads the span’s intervals from the pinned revision, with accounts at each end', async () => {
      const report = await service.growth(context(FleetReportView.FULL));

      const [{ where, order }] = intervals.find.mock.calls[0] as [
        {
          where: Record<string, unknown>;
          order: Record<string, string>;
        },
      ];

      expect(where).toMatchObject({ fleetId: 'fleet-1', revision: 4 });
      expect((where.toImportId as FindOperator<string[]>).value).toEqual([
        'import-1',
        'import-2',
        'import-3',
      ]);
      expect(order).toEqual({ toAt: 'ASC' });
      expect(queries.accounts).toHaveBeenCalledWith([
        'import-1',
        'import-2',
        'import-3',
      ]);
      expect(report.report).toBe(FleetReport.GROWTH);
      expect(report.intervals[0]).toEqual({
        from: { importId: 'import-1', exportedAt: NOV_1 },
        to: { importId: 'import-2', exportedAt: NOV_15 },
        partial: true,
        membersAtStart: 40,
        membersAtEnd: 42,
        joined: 6,
        rejoined: 0,
        left: 3,
        unknown: 9,
        acrossGap: 1,
        accountsAtStart: 31,
        accountsAtEnd: 33,
      });
      // An export with no count listed nobody.
      expect(report.intervals[1].accountsAtEnd).toBe(0);
    });

    it('hides an aggregate audience’s small figures, and one more of the movements', async () => {
      const report = await service.growth(context(FleetReportView.AGGREGATE));

      expect(report.intervals[0]).toMatchObject({
        membersAtStart: 40,
        membersAtEnd: 42,
        // left (3) and across a gap (1) count 4 between them, so rejoined
        // (0) and then joined (6) are hidden too.
        joined: null,
        rejoined: null,
        left: null,
        unknown: 9,
        acrossGap: null,
      });
      expect(report.intervals[1]).toMatchObject({
        membersAtStart: 42,
        membersAtEnd: null,
        left: 39,
        accountsAtEnd: 0,
      });
    });

    it('hides the smallest other movement when only one is small', async () => {
      intervals.find.mockResolvedValue([
        interval({ joined: 6, rejoined: 2, left: 7, unknown: 9, acrossGap: 5 }),
      ]);

      const [row] = (await service.growth(context(FleetReportView.AGGREGATE)))
        .intervals;

      expect([
        row.joined,
        row.rejoined,
        row.left,
        row.unknown,
        row.acrossGap,
      ]).toEqual([6, null, 7, 9, null]);
    });

    it('counts no accounts at either end of an interval nobody was listed at', async () => {
      queries.accounts.mockResolvedValue([]);

      const [row] = (await service.growth(context(FleetReportView.FULL)))
        .intervals;

      expect([row.accountsAtStart, row.accountsAtEnd]).toEqual([0, 0]);
    });

    it('reads nothing for an empty span', async () => {
      await expect(
        service.growth(context(FleetReportView.FULL, [])),
      ).resolves.toMatchObject({ intervals: [] });
      expect(intervals.find).not.toHaveBeenCalled();
    });
  });

  describe('activity', () => {
    it('bands each export’s members, every band shown and totalled', async () => {
      const report = await service.activity(context(FleetReportView.FULL));

      expect(queries.activity).toHaveBeenCalledWith('fleet-1', 4, [
        'import-1',
        'import-2',
        'import-3',
      ]);
      expect(report.exports[0]).toEqual({
        export: { importId: 'import-1', exportedAt: NOV_1 },
        partial: false,
        members: 40,
        bands: {
          [RosterActivityBand.WITHIN_7_DAYS]: 20,
          [RosterActivityBand.WITHIN_30_DAYS]: 12,
          [RosterActivityBand.WITHIN_90_DAYS]: 0,
          [RosterActivityBand.OVER_90_DAYS]: 3,
          [RosterActivityBand.UNKNOWN]: 5,
        },
      });
      expect(report.exports[1]).toMatchObject({
        partial: true,
        members: 0,
        bands: { [RosterActivityBand.WITHIN_7_DAYS]: 0 },
      });
    });

    it('hides an aggregate audience’s small bands, and others until they count five', async () => {
      const report = await service.activity(context(FleetReportView.AGGREGATE));

      expect(report.exports[0]).toMatchObject({
        members: 40,
        bands: {
          [RosterActivityBand.WITHIN_7_DAYS]: 20,
          [RosterActivityBand.WITHIN_30_DAYS]: 12,
          [RosterActivityBand.WITHIN_90_DAYS]: null,
          [RosterActivityBand.OVER_90_DAYS]: null,
          [RosterActivityBand.UNKNOWN]: null,
        },
      });
    });

    it('hides a small total from an aggregate audience', async () => {
      queries.activity.mockResolvedValue([
        {
          importId: 'import-1',
          band: RosterActivityBand.WITHIN_7_DAYS,
          count: 3,
        },
      ]);

      const report = await service.activity(context(FleetReportView.AGGREGATE));

      expect(report.exports[0].members).toBeNull();
    });
  });
});
