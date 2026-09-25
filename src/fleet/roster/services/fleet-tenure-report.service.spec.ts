import { Repository } from 'typeorm';

import { RosterChangeEntity } from '../../projection/entities/roster-change.entity';
import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';
import { RosterTenureBand } from '../enums/roster-tenure-band.enum';
import { FleetReportContext } from './fleet-report-context.service';
import { FleetReportQueryService } from './fleet-report-query.service';
import { FleetTenureReportService } from './fleet-tenure-report.service';
import { RosterRankOrderService } from './roster-rank-order.service';

const NOV_1 = new Date('2024-11-01T12:00:00Z');
const DEC_1 = new Date('2024-12-01T12:00:00Z');

const EXPORTS = [
  { importId: 'import-1', exportedAt: NOV_1, partial: false },
  { importId: 'import-2', exportedAt: DEC_1, partial: true },
];

/**
 * Opens a context over the two exports.
 *
 * @param view - How much the viewer is shown.
 * @param overrides - Fields to change.
 * @returns The context.
 */
function context(
  view: FleetReportView,
  overrides: Partial<FleetReportContext> = {},
): FleetReportContext {
  return {
    fleetId: 'fleet-1',
    header: {
      report: FleetReport.TENURE,
      view,
      revision: 4,
      publishedAt: null,
      stale: false,
      range: { from: null, to: null },
      coverage: { exports: 2, first: null, latest: null },
      minimumCohort: 5,
    },
    exports: EXPORTS,
    first: EXPORTS[0],
    at: view === FleetReportView.FULL ? EXPORTS[1] : null,
    ...overrides,
  };
}

/**
 * Builds a rank change.
 *
 * @param fromRank - The label before.
 * @param toRank - The label after.
 * @param acrossGap - Whether its bounds are wider than the interval.
 * @returns The change.
 */
function rankChange(
  fromRank: string,
  toRank: string,
  acrossGap = false,
): RosterChangeEntity {
  return {
    toImportId: 'import-2',
    acrossGap,
    kind: RosterChangeKind.RANK_CHANGED,
    detail: { fromRank, toRank },
  } as RosterChangeEntity;
}

describe('FleetTenureReportService', () => {
  let changes: { find: jest.Mock };
  let queries: {
    tenure: jest.Mock;
    tenureMembers: jest.Mock;
    ranks: jest.Mock;
  };
  let rankOrder: { tiers: jest.Mock };
  let service: FleetTenureReportService;

  beforeEach(() => {
    changes = {
      find: jest.fn(() =>
        Promise.resolve([
          rankChange('Member', 'Officer'),
          rankChange('Officer', 'Member'),
          rankChange('Member', 'Veteran'),
          rankChange('Recruit', 'Member'),
          rankChange('Cadet', 'Member'),
          rankChange('Member', 'Officer', true),
        ]),
      ),
    };
    queries = {
      tenure: jest.fn(() =>
        Promise.resolve([
          {
            importId: 'import-2',
            band: RosterTenureBand.UNDER_30_DAYS,
            openStart: false,
            count: 3,
          },
          {
            importId: 'import-2',
            band: RosterTenureBand.YEARS_1_TO_2,
            openStart: false,
            count: 8,
          },
          {
            importId: 'import-2',
            band: RosterTenureBand.YEARS_1_TO_2,
            openStart: true,
            count: 2,
          },
          {
            importId: 'import-2',
            band: RosterTenureBand.OVER_2_YEARS,
            openStart: true,
            count: 20,
          },
        ]),
      ),
      tenureMembers: jest.fn(() =>
        Promise.resolve([
          {
            identityId: 'identity-1',
            characterName: 'Aria Venn',
            accountHandle: '@fixture001',
            firstObservedAt: new Date('2022-11-30T12:00:00Z'),
            openStart: true,
          },
          {
            identityId: 'identity-2',
            characterName: 'Kess Tarin',
            accountHandle: '@fixture030',
            firstObservedAt: '2024-11-15T12:00:00.000Z',
            openStart: false,
          },
        ]),
      ),
      ranks: jest.fn(() =>
        Promise.resolve([
          { importId: 'import-1', label: 'Recruit', count: 9 },
          { importId: 'import-1', label: 'Officer', count: 6 },
          { importId: 'import-1', label: 'Cadet', count: 2 },
          { importId: 'import-1', label: 'Member', count: 30 },
          { importId: 'import-2', label: 'Officer', count: 7 },
        ]),
      ),
    };
    rankOrder = {
      tiers: jest.fn(() =>
        Promise.resolve(
          new Map([
            ['Officer', 1],
            ['Member', 2],
            ['Veteran', 2],
          ]),
        ),
      ),
    };
    service = new FleetTenureReportService(
      changes as unknown as Repository<RosterChangeEntity>,
      queries as unknown as FleetReportQueryService,
      rankOrder as unknown as RosterRankOrderService,
    );
  });

  describe('tenure', () => {
    it('bands each export’s members, with those listed at least that long', async () => {
      const report = await service.tenure(context(FleetReportView.FULL));

      expect(queries.tenure).toHaveBeenCalledWith('fleet-1', 4, [
        'import-1',
        'import-2',
      ]);
      expect(report.exports[0]).toMatchObject({ members: 0 });
      expect(report.exports[1]).toEqual({
        export: { importId: 'import-2', exportedAt: DEC_1 },
        partial: true,
        members: 33,
        bands: {
          [RosterTenureBand.UNDER_30_DAYS]: 3,
          [RosterTenureBand.DAYS_30_TO_90]: 0,
          [RosterTenureBand.MONTHS_3_TO_12]: 0,
          [RosterTenureBand.YEARS_1_TO_2]: 10,
          [RosterTenureBand.OVER_2_YEARS]: 20,
        },
        atLeast: {
          [RosterTenureBand.UNDER_30_DAYS]: 0,
          [RosterTenureBand.DAYS_30_TO_90]: 0,
          [RosterTenureBand.MONTHS_3_TO_12]: 0,
          [RosterTenureBand.YEARS_1_TO_2]: 2,
          [RosterTenureBand.OVER_2_YEARS]: 20,
        },
      });
    });

    it('lists a full view’s members at the export asked for, in whole days', async () => {
      const report = await service.tenure(context(FleetReportView.FULL));

      expect(queries.tenureMembers).toHaveBeenCalledWith(
        'fleet-1',
        4,
        'import-2',
      );
      expect(report.at).toEqual({ importId: 'import-2', exportedAt: DEC_1 });
      expect(report.members).toEqual([
        {
          identityId: 'identity-1',
          characterName: 'Aria Venn',
          accountHandle: '@fixture001',
          firstObservedAt: new Date('2022-11-30T12:00:00Z'),
          days: 732,
          band: RosterTenureBand.OVER_2_YEARS,
          atLeast: true,
        },
        {
          identityId: 'identity-2',
          characterName: 'Kess Tarin',
          accountHandle: '@fixture030',
          firstObservedAt: new Date('2024-11-15T12:00:00Z'),
          days: 16,
          band: RosterTenureBand.UNDER_30_DAYS,
          atLeast: false,
        },
      ]);
    });

    it.each([
      [0, RosterTenureBand.UNDER_30_DAYS],
      [29, RosterTenureBand.UNDER_30_DAYS],
      [30, RosterTenureBand.DAYS_30_TO_90],
      [89, RosterTenureBand.DAYS_30_TO_90],
      [90, RosterTenureBand.MONTHS_3_TO_12],
      [364, RosterTenureBand.MONTHS_3_TO_12],
      [365, RosterTenureBand.YEARS_1_TO_2],
      [729, RosterTenureBand.YEARS_1_TO_2],
      [730, RosterTenureBand.OVER_2_YEARS],
    ])('bands %i days as %s', async (days, band) => {
      queries.tenureMembers.mockResolvedValue([
        {
          identityId: 'identity-1',
          characterName: 'Aria Venn',
          accountHandle: '@fixture001',
          firstObservedAt: new Date(DEC_1.getTime() - days * 86_400_000),
          openStart: false,
        },
      ]);

      const report = await service.tenure(context(FleetReportView.FULL));

      expect(report.members?.[0]).toMatchObject({ days, band });
    });

    it('names nobody to an aggregate audience, and hides its small figures', async () => {
      const report = await service.tenure(context(FleetReportView.AGGREGATE));

      expect(report.at).toBeNull();
      expect(report.members).toBeNull();
      expect(queries.tenureMembers).not.toHaveBeenCalled();
      expect(report.exports[1]).toMatchObject({
        members: 33,
        bands: {
          // 3 is hidden, then 0 and 0 give nothing, so 10 goes too.
          [RosterTenureBand.UNDER_30_DAYS]: null,
          [RosterTenureBand.DAYS_30_TO_90]: null,
          [RosterTenureBand.MONTHS_3_TO_12]: null,
          [RosterTenureBand.YEARS_1_TO_2]: null,
          [RosterTenureBand.OVER_2_YEARS]: 20,
        },
        atLeast: {
          [RosterTenureBand.YEARS_1_TO_2]: null,
          [RosterTenureBand.OVER_2_YEARS]: 20,
        },
      });
    });
  });

  describe('ranks', () => {
    it('counts each export’s members by label, highest tier first', async () => {
      const report = await service.ranks(context(FleetReportView.FULL));

      expect(queries.ranks).toHaveBeenCalledWith('fleet-1', 4, [
        'import-1',
        'import-2',
      ]);
      expect(report.exports[0].labels).toEqual([
        { label: 'Officer', tier: 1, members: 6 },
        { label: 'Member', tier: 2, members: 30 },
        { label: 'Cadet', tier: null, members: 2 },
        { label: 'Recruit', tier: null, members: 9 },
      ]);
    });

    it('counts the rank changes each export revealed by what the tiers make of them', async () => {
      const report = await service.ranks(context(FleetReportView.FULL));

      expect(changes.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fleetId: 'fleet-1',
            revision: 4,
            kind: RosterChangeKind.RANK_CHANGED,
          }) as unknown,
        }),
      );
      // The Fleet's first export ends no interval.
      expect(report.exports[0].changes).toBeNull();
      expect(report.exports[1].changes).toEqual({
        promoted: 1,
        demoted: 1,
        changed: 3,
        acrossGap: 1,
      });
    });

    it('counts changes at a span’s first export when it is not the Fleet’s', async () => {
      const report = await service.ranks(
        context(FleetReportView.FULL, {
          first: { importId: 'import-0', exportedAt: NOV_1, partial: false },
        }),
      );

      expect(report.exports[0].changes).toEqual({
        promoted: 0,
        demoted: 0,
        changed: 0,
        acrossGap: 0,
      });
    });

    it('hides an aggregate audience’s small figures', async () => {
      const report = await service.ranks(context(FleetReportView.AGGREGATE));

      expect(report.exports[0].labels.map(label => label.members)).toEqual([
        null,
        30,
        null,
        9,
      ]);
      expect(report.exports[1].changes).toEqual({
        promoted: null,
        demoted: null,
        changed: null,
        acrossGap: null,
      });
    });

    it('reads nothing for an empty span', async () => {
      await expect(
        service.ranks(context(FleetReportView.FULL, { exports: [] })),
      ).resolves.toMatchObject({ exports: [] });
      expect(queries.ranks).not.toHaveBeenCalled();
    });
  });
});
