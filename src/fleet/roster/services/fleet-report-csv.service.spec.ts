import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';
import { FleetContributionReportDto } from '../dto/fleet-contribution-report.dto';
import {
  FleetActivityReportDto,
  FleetGrowthReportDto,
} from '../dto/fleet-growth-report.dto';
import { FleetReportHeaderDto } from '../dto/fleet-report.dto';
import {
  FleetRanksReportDto,
  FleetTenureReportDto,
} from '../dto/fleet-tenure-report.dto';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';
import { RosterActivityBand } from '../enums/roster-activity-band.enum';
import { RosterTenureBand } from '../enums/roster-tenure-band.enum';
import { FleetReportCsvService } from './fleet-report-csv.service';

const NOW = new Date('2026-09-25T12:00:00Z');
const NOV_15 = new Date('2024-11-15T12:00:00Z');
const DEC_1 = new Date('2024-12-01T12:00:00Z');
const FROM = { importId: 'import-1', exportedAt: NOV_15 };
const TO = { importId: 'import-2', exportedAt: DEC_1 };

/**
 * Builds a report's header.
 *
 * @param report - The report.
 * @param view - How much the viewer is shown.
 * @returns The header.
 */
function header(
  report: FleetReport,
  view = FleetReportView.FULL,
): FleetReportHeaderDto {
  return {
    report,
    view,
    revision: 17,
    publishedAt: new Date('2026-09-25T00:30:00Z'),
    stale: false,
    range: { from: null, to: null },
    coverage: { exports: 2, first: FROM, latest: TO },
    minimumCohort: 5,
  };
}

/**
 * Splits a rendered report into its lines, byte order mark checked and
 * removed.
 *
 * @param csv - The rendered report.
 * @returns Its lines, the trailing empty one dropped.
 */
function lines(csv: string): string[] {
  expect(csv.startsWith('\u{FEFF}')).toBe(true);

  return csv.slice(1).split('\r\n').slice(0, -1);
}

describe('FleetReportCsvService', () => {
  const service = new FleetReportCsvService();

  describe('the heading', () => {
    it('says which report, revision, span and view, and when', () => {
      const csv = lines(
        service.render(
          { ...header(FleetReport.GROWTH), intervals: [] },
          'Fixture Basic Fleet',
          NOW,
        ),
      );

      expect(csv.slice(0, 5)).toEqual([
        '# Growth and loss: Fixture Basic Fleet',
        '# Revision 17 (published 2026-09-25T00:30:00.000Z)',
        '# Span: the first export to the latest export; 2 effective export(s)',
        '# Full detail',
        '# Generated 2026-09-25T12:00:00.000Z',
      ]);
    });

    it('says when a revision is unpublished or stale, the span is set, and figures hidden', () => {
      const csv = lines(
        service.render(
          {
            ...header(FleetReport.GROWTH, FleetReportView.AGGREGATE),
            publishedAt: null,
            revision: 0,
            stale: true,
            range: { from: NOV_15, to: DEC_1 },
            intervals: [],
          },
          'Fixture Basic Fleet',
          NOW,
        ),
      );

      expect(csv.slice(1, 4)).toEqual([
        '# Revision 0; a newer one is waiting to be built',
        '# Span: 2024-11-15T12:00:00.000Z to 2024-12-01T12:00:00.000Z; 2 effective export(s)',
        '# Aggregates only: figures counting fewer than 5 members (or revealing one) are written < 5',
      ]);
    });
  });

  it('writes growth, a hidden figure as < 5', () => {
    const report: FleetGrowthReportDto = {
      ...header(FleetReport.GROWTH, FleetReportView.AGGREGATE),
      intervals: [
        {
          from: FROM,
          to: TO,
          partial: true,
          membersAtStart: 40,
          membersAtEnd: 42,
          joined: null,
          rejoined: 0,
          left: null,
          unknown: 9,
          acrossGap: null,
          accountsAtStart: 31,
          accountsAtEnd: 33,
        },
      ],
    };

    expect(lines(service.render(report, 'Fleet', NOW)).slice(6)).toEqual([
      'From export,To export,Partial,Members at start,Members at end,Joined,Rejoined,Left,Unknown,Across a gap,Observed accounts at start,Observed accounts at end',
      '2024-11-15T12:00:00.000Z,2024-12-01T12:00:00.000Z,true,40,42,< 5,0,< 5,9,< 5,31,33',
    ]);
  });

  it('writes activity, a band to a column', () => {
    const report: FleetActivityReportDto = {
      ...header(FleetReport.ACTIVITY),
      exports: [
        {
          export: TO,
          partial: false,
          members: 40,
          bands: {
            [RosterActivityBand.WITHIN_7_DAYS]: 20,
            [RosterActivityBand.WITHIN_30_DAYS]: 12,
            [RosterActivityBand.WITHIN_90_DAYS]: 0,
            [RosterActivityBand.OVER_90_DAYS]: 3,
            [RosterActivityBand.UNKNOWN]: 5,
          },
        },
      ],
    };

    expect(lines(service.render(report, 'Fleet', NOW)).slice(6)).toEqual([
      'Export,Partial,Members,Active within 7 days,Within 30 days,Within 90 days,Over 90 days,No Last Active',
      '2024-12-01T12:00:00.000Z,false,40,20,12,0,3,5',
    ]);
  });

  describe('tenure', () => {
    const bands = {
      [RosterTenureBand.UNDER_30_DAYS]: 3,
      [RosterTenureBand.DAYS_30_TO_90]: 0,
      [RosterTenureBand.MONTHS_3_TO_12]: 0,
      [RosterTenureBand.YEARS_1_TO_2]: 10,
      [RosterTenureBand.OVER_2_YEARS]: 20,
    };
    const atLeast = {
      [RosterTenureBand.UNDER_30_DAYS]: 0,
      [RosterTenureBand.DAYS_30_TO_90]: 0,
      [RosterTenureBand.MONTHS_3_TO_12]: 0,
      [RosterTenureBand.YEARS_1_TO_2]: null,
      [RosterTenureBand.OVER_2_YEARS]: 20,
    };

    it('writes the bands and, for a full view, the members apart', () => {
      const report: FleetTenureReportDto = {
        ...header(FleetReport.TENURE),
        exports: [{ export: TO, partial: false, members: 33, bands, atLeast }],
        at: TO,
        members: [
          {
            identityId: 'identity-1',
            characterName: '=Aria, Venn',
            accountHandle: '@fixture001',
            firstObservedAt: new Date('2022-11-30T12:00:00Z'),
            days: 732,
            band: RosterTenureBand.OVER_2_YEARS,
            atLeast: true,
          },
        ],
      };

      expect(lines(service.render(report, 'Fleet', NOW)).slice(6)).toEqual([
        'Export,Partial,Members,Under 30 days,30 to 90 days,90 days to 1 year,1 to 2 years,2 years or more,Under 30 days: at least,30 to 90 days: at least,90 days to 1 year: at least,1 to 2 years: at least,2 years or more: at least',
        '2024-12-01T12:00:00.000Z,false,33,3,0,0,10,20,0,0,0,< 5,20',
        '',
        '# Members at 2024-12-01T12:00:00.000Z',
        'Character,Account handle,First listed,Days,At least',
        // A name a spreadsheet would run is neutralised, and quoted for its comma.
        `"'=Aria, Venn",'@fixture001,2022-11-30T12:00:00.000Z,732,true`,
      ]);
    });

    it('writes the bands alone for an aggregate view', () => {
      const report: FleetTenureReportDto = {
        ...header(FleetReport.TENURE, FleetReportView.AGGREGATE),
        exports: [{ export: TO, partial: false, members: 33, bands, atLeast }],
        at: null,
        members: null,
      };

      expect(lines(service.render(report, 'Fleet', NOW))).toHaveLength(8);
    });
  });

  it('writes ranks a label to a row, and the changes after', () => {
    const report: FleetRanksReportDto = {
      ...header(FleetReport.RANKS),
      exports: [
        {
          export: FROM,
          partial: false,
          labels: [{ label: 'Officer', tier: 1, members: 6 }],
          changes: null,
        },
        {
          export: TO,
          partial: true,
          labels: [
            { label: 'Officer', tier: 1, members: 7 },
            { label: 'Cadet', tier: null, members: null },
          ],
          changes: { promoted: 1, demoted: 0, changed: null, acrossGap: 0 },
        },
      ],
    };

    expect(lines(service.render(report, 'Fleet', NOW)).slice(6)).toEqual([
      'Export,Partial,Rank label,Tier,Members',
      '2024-11-15T12:00:00.000Z,false,Officer,1,6',
      '2024-12-01T12:00:00.000Z,true,Officer,1,7',
      '2024-12-01T12:00:00.000Z,true,Cadet,,< 5',
      '',
      '# Rank changes each export revealed',
      'Export,Promoted,Demoted,Rank changed,Across a gap',
      '2024-12-01T12:00:00.000Z,1,0,< 5,0',
    ]);
  });

  describe('contribution', () => {
    const interval = {
      from: FROM,
      to: TO,
      partial: false,
      contributionDelta: '98100',
      known: 30,
      reset: null,
      baseline: null,
      unknown: 11,
    };

    it('writes the intervals and, for a full view, the members apart', () => {
      const report: FleetContributionReportDto = {
        ...header(FleetReport.CONTRIBUTION),
        intervals: [interval],
        at: TO,
        members: [
          {
            identityId: 'identity-1',
            member: {
              characterName: 'Kell Marr',
              accountHandle: '@fixture003',
            },
            kind: RosterChangeKind.CONTRIBUTION_CHANGED,
            delta: '1000',
            fromContribution: '4414000',
            toContribution: '4415000',
            from: FROM,
            acrossGap: false,
          },
          {
            identityId: 'identity-2',
            member: null,
            kind: RosterChangeKind.CONTRIBUTION_RESET,
            delta: null,
            fromContribution: '120600',
            toContribution: '120500',
            from: null,
            acrossGap: true,
          },
        ],
      };

      expect(lines(service.render(report, 'Fleet', NOW)).slice(6)).toEqual([
        'From export,To export,Partial,Contribution delta,Known,Reset,Baseline,Unknown',
        '2024-11-15T12:00:00.000Z,2024-12-01T12:00:00.000Z,false,98100,30,< 5,< 5,11',
        '',
        '# Members in the interval ending 2024-12-01T12:00:00.000Z',
        'Character,Account handle,Change,Delta,Total before,Total after,After export,Across a gap',
        "Kell Marr,'@fixture003,Rise,1000,4414000,4415000,2024-11-15T12:00:00.000Z,false",
        ',,Reset,,120600,120500,,true',
      ]);
    });

    it('writes the intervals alone for an aggregate view', () => {
      const report: FleetContributionReportDto = {
        ...header(FleetReport.CONTRIBUTION, FleetReportView.AGGREGATE),
        intervals: [{ ...interval, contributionDelta: null }],
        at: null,
        members: null,
      };
      const csv = lines(service.render(report, 'Fleet', NOW));

      expect(csv).toHaveLength(8);
      expect(csv[7]).toContain(',false,< 5,30,');
    });
  });
});
