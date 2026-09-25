import { FindOperator, Repository } from 'typeorm';

import { RosterChangeEntity } from '../../projection/entities/roster-change.entity';
import { RosterIntervalSummaryEntity } from '../../projection/entities/roster-interval-summary.entity';
import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';
import { FleetContributionReportService } from './fleet-contribution-report.service';
import { FleetReportContext } from './fleet-report-context.service';
import { RosterMemberNameService } from './roster-member-name.service';

const NOV_15 = new Date('2024-11-15T12:00:00Z');
const DEC_1 = new Date('2024-12-01T12:00:00Z');

const EXPORTS = [
  { importId: 'import-1', exportedAt: NOV_15, partial: false },
  { importId: 'import-2', exportedAt: DEC_1, partial: false },
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
      report: FleetReport.CONTRIBUTION,
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
 * Builds a contribution change revealed at the second export.
 *
 * @param identityId - The member.
 * @param delta - The rise, or null for a reset.
 * @param overrides - Fields to change.
 * @returns The change.
 */
function change(
  identityId: string,
  delta: string | null,
  overrides: Partial<RosterChangeEntity> = {},
): RosterChangeEntity {
  return {
    identityId,
    kind:
      delta === null
        ? RosterChangeKind.CONTRIBUTION_RESET
        : RosterChangeKind.CONTRIBUTION_CHANGED,
    fromImportId: 'import-1',
    fromAt: NOV_15,
    toImportId: 'import-2',
    toAt: DEC_1,
    acrossGap: false,
    contributionDelta: delta,
    detail: { fromContribution: '100', toContribution: '200' },
    ...overrides,
  } as RosterChangeEntity;
}

describe('FleetContributionReportService', () => {
  let intervals: { find: jest.Mock };
  let changes: { find: jest.Mock };
  let names: { names: jest.Mock };
  let service: FleetContributionReportService;

  beforeEach(() => {
    intervals = {
      find: jest.fn(() =>
        Promise.resolve([
          {
            fromImportId: 'import-1',
            fromAt: NOV_15,
            toImportId: 'import-2',
            toAt: DEC_1,
            partial: false,
            contributionDelta: '98100',
            contributionKnown: 30,
            contributionReset: 2,
            contributionBaseline: 6,
            contributionUnknown: 11,
          },
        ]),
      ),
    };
    changes = {
      find: jest.fn(() =>
        Promise.resolve([
          change('identity-reset', null, { detail: {} }),
          change('identity-small', '100'),
          change('identity-big', '9000000000000'),
          change('identity-tie-b', '500'),
          change('identity-tie-a', '500'),
          change('identity-gap', '700', {
            acrossGap: true,
            fromImportId: null,
            fromAt: null,
          }),
        ]),
      ),
    };
    names = {
      names: jest.fn(() =>
        Promise.resolve(
          new Map([
            [
              'import-2/identity-big',
              { characterName: 'Kell Marr', accountHandle: '@fixture003' },
            ],
            [
              'import-2/identity-tie-b',
              { characterName: 'Aria Venn', accountHandle: '@fixture001' },
            ],
            [
              'import-2/identity-tie-a',
              { characterName: 'Zara Quell', accountHandle: '@fixture050' },
            ],
          ]),
        ),
      ),
    };
    service = new FleetContributionReportService(
      intervals as unknown as Repository<RosterIntervalSummaryEntity>,
      changes as unknown as Repository<RosterChangeEntity>,
      names as unknown as RosterMemberNameService,
    );
  });

  it('reads the span’s interval totals from the pinned revision', async () => {
    const report = await service.contribution(context(FleetReportView.FULL));

    const [{ where }] = intervals.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];

    expect(where).toMatchObject({ fleetId: 'fleet-1', revision: 4 });
    expect((where.toImportId as FindOperator<string[]>).value).toEqual([
      'import-1',
      'import-2',
    ]);
    expect(report.intervals).toEqual([
      {
        from: { importId: 'import-1', exportedAt: NOV_15 },
        to: { importId: 'import-2', exportedAt: DEC_1 },
        partial: false,
        contributionDelta: '98100',
        known: 30,
        reset: 2,
        baseline: 6,
        unknown: 11,
      },
    ]);
  });

  it('lists each member’s rise largest first, then the resets, by name', async () => {
    const report = await service.contribution(context(FleetReportView.FULL));

    expect(report.at).toEqual({ importId: 'import-2', exportedAt: DEC_1 });
    expect(
      report.members?.map(member => [
        member.identityId,
        member.delta,
        member.member?.characterName ?? null,
      ]),
    ).toEqual([
      // Larger than a double holds exactly: compared as whole numbers.
      ['identity-big', '9000000000000', 'Kell Marr'],
      ['identity-gap', '700', null],
      ['identity-tie-b', '500', 'Aria Venn'],
      ['identity-tie-a', '500', 'Zara Quell'],
      ['identity-small', '100', null],
      ['identity-reset', null, null],
    ]);
    expect(report.members?.[0]).toEqual({
      identityId: 'identity-big',
      member: { characterName: 'Kell Marr', accountHandle: '@fixture003' },
      kind: RosterChangeKind.CONTRIBUTION_CHANGED,
      delta: '9000000000000',
      fromContribution: '100',
      toContribution: '200',
      from: { importId: 'import-1', exportedAt: NOV_15 },
      acrossGap: false,
    });
    expect(report.members?.[1]).toMatchObject({ from: null, acrossGap: true });
    expect(report.members?.[5]).toMatchObject({
      kind: RosterChangeKind.CONTRIBUTION_RESET,
      fromContribution: null,
      toContribution: null,
    });
  });

  it('asks only for the rises and resets the detail export revealed', async () => {
    await service.contribution(context(FleetReportView.FULL));

    const [{ where }] = changes.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];

    expect(where).toMatchObject({
      fleetId: 'fleet-1',
      revision: 4,
      toImportId: 'import-2',
    });
    expect((where.kind as FindOperator<string[]>).value).toEqual([
      RosterChangeKind.CONTRIBUTION_CHANGED,
      RosterChangeKind.CONTRIBUTION_RESET,
    ]);
    expect(names.names).toHaveBeenCalledWith(
      'fleet-1',
      expect.arrayContaining([
        { importId: 'import-2', identityId: 'identity-big' },
      ]),
    );
  });

  it('puts every reset after every rise, whichever way round they come', async () => {
    changes.find.mockResolvedValue([
      change('identity-reset-b', null),
      change('identity-rise', '100'),
      change('identity-reset-a', null),
    ]);
    names.names.mockResolvedValue(new Map());

    const report = await service.contribution(context(FleetReportView.FULL));

    expect(report.members?.map(member => member.identityId)).toEqual([
      'identity-rise',
      'identity-reset-a',
      'identity-reset-b',
    ]);
  });

  it('orders two unnamed members with one rise by identity', async () => {
    changes.find.mockResolvedValue([
      change('identity-b', '100'),
      change('identity-a', '100'),
    ]);
    names.names.mockResolvedValue(new Map());

    const report = await service.contribution(context(FleetReportView.FULL));

    expect(report.members?.map(member => member.identityId)).toEqual([
      'identity-a',
      'identity-b',
    ]);
  });

  it('names nobody to an aggregate audience, and hides its small counts', async () => {
    const report = await service.contribution(
      context(FleetReportView.AGGREGATE),
    );

    expect(report.at).toBeNull();
    expect(report.members).toBeNull();
    expect(changes.find).not.toHaveBeenCalled();
    expect(report.intervals[0]).toMatchObject({
      contributionDelta: '98100',
      // reset (2) is hidden, then baseline (6) until the hidden count five.
      known: 30,
      reset: null,
      baseline: null,
      unknown: 11,
    });
  });

  it('hides a total fewer than five members’ deltas make up', async () => {
    intervals.find.mockResolvedValue([
      {
        fromImportId: 'import-1',
        fromAt: NOV_15,
        toImportId: 'import-2',
        toAt: DEC_1,
        partial: false,
        contributionDelta: '1023',
        contributionKnown: 2,
        contributionReset: 0,
        contributionBaseline: 40,
        contributionUnknown: 0,
      },
    ]);

    const [row] = (
      await service.contribution(context(FleetReportView.AGGREGATE))
    ).intervals;

    expect(row.contributionDelta).toBeNull();
    expect(row.known).toBeNull();
  });

  it('reads nothing for an empty span', async () => {
    const report = await service.contribution(
      context(FleetReportView.FULL, { exports: [], at: null }),
    );

    expect(report).toMatchObject({ intervals: [], at: null, members: null });
    expect(intervals.find).not.toHaveBeenCalled();
  });
});
