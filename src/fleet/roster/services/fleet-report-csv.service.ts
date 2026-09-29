import { Injectable } from '@nestjs/common';

import { CSV_BOM, CsvValue, toCsv } from 'src/shared/utilities/csv.utility';

import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';
import { FleetContributionReportDto } from '../dto/fleet-contribution-report.dto';
import {
  FleetActivityReportDto,
  FleetGrowthReportDto,
} from '../dto/fleet-growth-report.dto';
import {
  FleetAttendanceReportDto,
  FleetHoldingsReportDto,
  FleetRecordReportHeaderDto,
  FleetRecruitmentReportDto,
} from '../dto/fleet-record-report.dto';
import { FleetReportHeaderDto } from '../dto/fleet-report.dto';
import {
  FleetRanksReportDto,
  FleetTenureReportDto,
} from '../dto/fleet-tenure-report.dto';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';
import { RosterActivityBand } from '../enums/roster-activity-band.enum';
import { RosterTenureBand } from '../enums/roster-tenure-band.enum';

/** Any report, as its route gives it. */
export type FleetReportDto =
  | FleetGrowthReportDto
  | FleetActivityReportDto
  | FleetTenureReportDto
  | FleetRanksReportDto
  | FleetContributionReportDto
  | FleetAttendanceReportDto
  | FleetRecruitmentReportDto
  | FleetHoldingsReportDto;

/** What a hidden figure is written as. */
const HIDDEN = '< 5';

/** Each report's name, as a reader would say it. */
const TITLES: Readonly<Record<FleetReport, string>> = {
  [FleetReport.GROWTH]: 'Growth and loss',
  [FleetReport.TENURE]: 'Tenure',
  [FleetReport.RANKS]: 'Ranks',
  [FleetReport.ACTIVITY]: 'Imported activity',
  [FleetReport.CONTRIBUTION]: 'Contribution',
  [FleetReport.ATTENDANCE]: 'Event attendance',
  [FleetReport.RECRUITMENT]: 'Recruitment',
  [FleetReport.HOLDINGS]: 'Holdings',
};

/** Each activity band's column heading. */
const ACTIVITY_COLUMNS: ReadonlyArray<[RosterActivityBand, string]> = [
  [RosterActivityBand.WITHIN_7_DAYS, 'Active within 7 days'],
  [RosterActivityBand.WITHIN_30_DAYS, 'Within 30 days'],
  [RosterActivityBand.WITHIN_90_DAYS, 'Within 90 days'],
  [RosterActivityBand.OVER_90_DAYS, 'Over 90 days'],
  [RosterActivityBand.UNKNOWN, 'No Last Active'],
];

/** Each tenure band's column heading. */
const TENURE_COLUMNS: ReadonlyArray<[RosterTenureBand, string]> = [
  [RosterTenureBand.UNDER_30_DAYS, 'Under 30 days'],
  [RosterTenureBand.DAYS_30_TO_90, '30 to 90 days'],
  [RosterTenureBand.MONTHS_3_TO_12, '90 days to 1 year'],
  [RosterTenureBand.YEARS_1_TO_2, '1 to 2 years'],
  [RosterTenureBand.OVER_2_YEARS, '2 years or more'],
];

/**
 * Writes a report as CSV (FC-020).
 *
 * The tables exactly as the viewer is shown them (Steve's decision of 25
 * September 2026): an aggregate view's export names nobody, and every
 * figure its view hid is written `< 5`. Comment lines above the tables say
 * which report, revision, span and view it is and when it was made. The
 * text starts with a byte order mark, so a spreadsheet reads it as UTF-8,
 * and every instant is ISO 8601 UTC.
 */
@Injectable()
export class FleetReportCsvService {
  /**
   * Writes a report.
   *
   * @param report - The report.
   * @param fleetName - The Fleet's name, for the heading.
   * @param now - When it is being made.
   * @returns The CSV text, byte order mark first.
   */
  render(report: FleetReportDto, fleetName: string, now: Date): string {
    return (
      CSV_BOM +
      [heading(report, fleetName, now), ...tables(report)]
        .map(rows => toCsv(rows))
        .join('\r\n')
    );
  }
}

/**
 * Writes a report's comment heading.
 *
 * The lines carry no comma of their own, so each is written unquoted,
 * starting `#`, unless the Fleet's name has one.
 *
 * @param report - The report.
 * @param fleetName - The Fleet's name.
 * @param now - When it is being made.
 * @returns The heading's rows.
 */
function heading(
  report: FleetReportHeaderDto | FleetRecordReportHeaderDto,
  fleetName: string,
  now: Date,
): CsvValue[][] {
  if (!('revision' in report)) {
    return recordHeading(report, fleetName, now);
  }

  const { range, coverage } = report;
  const lines = [
    `# ${TITLES[report.report]}: ${fleetName}`,
    `# Revision ${report.revision}${
      report.publishedAt === null
        ? ''
        : ` (published ${report.publishedAt.toISOString()})`
    }${report.stale ? '; a newer one is waiting to be built' : ''}`,
    `# Span: ${range.from?.toISOString() ?? 'the first export'} to ${
      range.to?.toISOString() ?? 'the latest export'
    }; ${coverage.exports} effective export(s)`,
    report.view === FleetReportView.AGGREGATE
      ? `# Aggregates only: figures counting fewer than ${report.minimumCohort} members (or revealing one) are written ${HIDDEN}`
      : '# Full detail',
    `# Generated ${now.toISOString()}`,
  ];

  return lines.map(line => [line]);
}

/**
 * Writes the heading of a report built from the Fleet's own records
 * (FC-030): its span and view, with no roster revision or exports.
 *
 * @param report - The report.
 * @param fleetName - The Fleet's name.
 * @param now - When it is being made.
 * @returns The heading's rows.
 */
function recordHeading(
  report: FleetRecordReportHeaderDto,
  fleetName: string,
  now: Date,
): CsvValue[][] {
  return [
    `# ${TITLES[report.report]}: ${fleetName}`,
    `# Span: ${report.range.from.toISOString()} to ${report.range.to.toISOString()}`,
    report.view === FleetReportView.AGGREGATE
      ? `# Aggregates only: figures counting fewer than ${report.minimumCohort} people (or revealing one) are written ${HIDDEN}`
      : '# Full detail',
    `# Generated ${now.toISOString()}`,
  ].map(line => [line]);
}

/**
 * Lays a report out as tables.
 *
 * @param report - The report.
 * @returns Its tables, each a list of rows, heading row first.
 */
function tables(report: FleetReportDto): CsvValue[][][] {
  switch (report.report) {
    case FleetReport.GROWTH:
      return [growth(report as FleetGrowthReportDto)];
    case FleetReport.ACTIVITY:
      return [activity(report as FleetActivityReportDto)];
    case FleetReport.TENURE:
      return tenure(report as FleetTenureReportDto);
    case FleetReport.RANKS:
      return ranks(report as FleetRanksReportDto);
    case FleetReport.CONTRIBUTION:
      return contribution(report as FleetContributionReportDto);
    case FleetReport.ATTENDANCE:
      return attendance(report as FleetAttendanceReportDto);
    case FleetReport.RECRUITMENT:
      return [recruitment(report as FleetRecruitmentReportDto)];
    case FleetReport.HOLDINGS:
      return [holdings(report as FleetHoldingsReportDto)];
  }
}

/**
 * Lays out the attendance report (FC-030).
 *
 * @param report - The report.
 * @returns Its tables: each occurrence with the totals, and for a full view
 *   each person.
 */
function attendance(report: FleetAttendanceReportDto): CsvValue[][][] {
  const occurrences: CsvValue[][] = [
    ['Starts', 'Event', 'Going', 'Came', 'Did not come', 'Rate'],
    ...report.occurrences.map(row => [
      row.startsAt,
      row.title,
      count(row.going),
      count(row.attended),
      count(row.absent),
      row.rate ?? '',
    ]),
    [
      `All ${report.totals.occurrences}`,
      '',
      '',
      count(report.totals.attended),
      count(report.totals.absent),
      report.totals.rate ?? '',
    ],
  ];

  return report.members === null
    ? [occurrences]
    : [
        occurrences,
        [
          ['# Each person'],
          ['Username', 'Came', 'Did not come'],
          ...report.members.map(row => [
            row.username ?? '',
            row.attended,
            row.absent,
          ]),
        ],
      ];
}

/**
 * Lays out the recruitment report (FC-030).
 *
 * @param report - The report.
 * @returns Its table.
 */
function recruitment(report: FleetRecruitmentReportDto): CsvValue[][] {
  return [
    [
      'Month',
      'Route',
      'Received',
      'Accepted',
      'Declined',
      'Withdrawn',
      'Lapsed',
      'Pending',
      'Median days to a decision',
    ],
    ...report.months.map(row => [
      row.month,
      row.route,
      count(row.received),
      count(row.accepted),
      count(row.declined),
      count(row.withdrawn),
      count(row.lapsed),
      count(row.pending),
      row.medianDaysToDecision ?? '',
    ]),
  ];
}

/**
 * Lays out the holdings report (FC-030).
 *
 * @param report - The report.
 * @returns Its table.
 */
function holdings(report: FleetHoldingsReportDto): CsvValue[][] {
  return [
    ['When', 'Holding', 'Track', 'From tier', 'To tier'],
    ...report.changes.map(row => [
      row.at,
      row.holding,
      row.track,
      row.from,
      row.to,
    ]),
  ];
}

/**
 * Writes a count, hidden or not.
 *
 * @param value - The count, or null where hidden.
 * @returns The cell.
 */
function count(value: number | string | null): CsvValue {
  return value ?? HIDDEN;
}

/**
 * Lays out the growth report.
 *
 * @param report - The report.
 * @returns Its table.
 */
function growth(report: FleetGrowthReportDto): CsvValue[][] {
  return [
    [
      'From export',
      'To export',
      'Partial',
      'Members at start',
      'Members at end',
      'Joined',
      'Rejoined',
      'Left',
      'Unknown',
      'Across a gap',
      'Observed accounts at start',
      'Observed accounts at end',
    ],
    ...report.intervals.map(row => [
      row.from.exportedAt,
      row.to.exportedAt,
      row.partial,
      count(row.membersAtStart),
      count(row.membersAtEnd),
      count(row.joined),
      count(row.rejoined),
      count(row.left),
      count(row.unknown),
      count(row.acrossGap),
      count(row.accountsAtStart),
      count(row.accountsAtEnd),
    ]),
  ];
}

/**
 * Lays out the activity report.
 *
 * @param report - The report.
 * @returns Its table.
 */
function activity(report: FleetActivityReportDto): CsvValue[][] {
  return [
    [
      'Export',
      'Partial',
      'Members',
      ...ACTIVITY_COLUMNS.map(([, name]) => name),
    ],
    ...report.exports.map(row => [
      row.export.exportedAt,
      row.partial,
      count(row.members),
      ...ACTIVITY_COLUMNS.map(([band]) => count(row.bands[band])),
    ]),
  ];
}

/**
 * Lays out the tenure report.
 *
 * @param report - The report.
 * @returns Its tables: the bands, and for a full view the members.
 */
function tenure(report: FleetTenureReportDto): CsvValue[][][] {
  const bands = [
    [
      'Export',
      'Partial',
      'Members',
      ...TENURE_COLUMNS.map(([, name]) => name),
      ...TENURE_COLUMNS.map(([, name]) => `${name}: at least`),
    ],
    ...report.exports.map(row => [
      row.export.exportedAt,
      row.partial,
      count(row.members),
      ...TENURE_COLUMNS.map(([band]) => count(row.bands[band])),
      ...TENURE_COLUMNS.map(([band]) => count(row.atLeast[band])),
    ]),
  ];

  if (report.members === null || report.at === null) {
    return [bands];
  }

  return [
    bands,
    [
      [`# Members at ${report.at.exportedAt.toISOString()}`],
      ['Character', 'Account handle', 'First listed', 'Days', 'At least'],
      ...report.members.map(member => [
        member.characterName,
        member.accountHandle,
        member.firstObservedAt,
        member.days,
        member.atLeast,
      ]),
    ],
  ];
}

/**
 * Lays out the ranks report.
 *
 * @param report - The report.
 * @returns Its tables: members by label, and rank changes.
 */
function ranks(report: FleetRanksReportDto): CsvValue[][][] {
  return [
    [
      ['Export', 'Partial', 'Rank label', 'Tier', 'Members'],
      ...report.exports.flatMap(row =>
        row.labels.map(label => [
          row.export.exportedAt,
          row.partial,
          label.label,
          label.tier,
          count(label.members),
        ]),
      ),
    ],
    [
      ['# Rank changes each export revealed'],
      ['Export', 'Promoted', 'Demoted', 'Rank changed', 'Across a gap'],
      ...report.exports.flatMap(row =>
        row.changes === null
          ? []
          : [
              [
                row.export.exportedAt,
                count(row.changes.promoted),
                count(row.changes.demoted),
                count(row.changes.changed),
                count(row.changes.acrossGap),
              ],
            ],
      ),
    ],
  ];
}

/**
 * Lays out the contribution report.
 *
 * @param report - The report.
 * @returns Its tables: the intervals, and for a full view the members.
 */
function contribution(report: FleetContributionReportDto): CsvValue[][][] {
  const intervals = [
    [
      'From export',
      'To export',
      'Partial',
      'Contribution delta',
      'Known',
      'Reset',
      'Baseline',
      'Unknown',
    ],
    ...report.intervals.map(row => [
      row.from.exportedAt,
      row.to.exportedAt,
      row.partial,
      count(row.contributionDelta),
      count(row.known),
      count(row.reset),
      count(row.baseline),
      count(row.unknown),
    ]),
  ];

  if (report.members === null || report.at === null) {
    return [intervals];
  }

  return [
    intervals,
    [
      [
        `# Members in the interval ending ${report.at.exportedAt.toISOString()}`,
      ],
      [
        'Character',
        'Account handle',
        'Change',
        'Delta',
        'Total before',
        'Total after',
        'After export',
        'Across a gap',
      ],
      ...report.members.map(member => [
        member.member?.characterName ?? null,
        member.member?.accountHandle ?? null,
        member.kind === RosterChangeKind.CONTRIBUTION_RESET ? 'Reset' : 'Rise',
        member.delta,
        member.fromContribution,
        member.toContribution,
        member.from?.exportedAt ?? null,
        member.acrossGap,
      ]),
    ],
  ];
}
