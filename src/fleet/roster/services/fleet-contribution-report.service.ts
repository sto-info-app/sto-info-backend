import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { compareText } from 'src/shared/utilities/compare-text.utility';

import { normaliseRosterAccountHandle } from '../../imports/utilities/roster-identity.utility';
import { RosterChangeEntity } from '../../projection/entities/roster-change.entity';
import { RosterIntervalSummaryEntity } from '../../projection/entities/roster-interval-summary.entity';
import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';
import {
  ContributionAccountDto,
  ContributionIntervalDto,
  ContributionMemberDto,
  FleetContributionReportDto,
} from '../dto/fleet-contribution-report.dto';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import {
  REPORT_MINIMUM_COHORT,
  suppressGroup,
} from '../utilities/report-suppression.utility';
import { FleetReportContext } from './fleet-report-context.service';
import {
  rosterMemberKey,
  RosterMemberNameService,
} from './roster-member-name.service';

/**
 * Builds the contribution report (FC-020).
 *
 * FC-019's interval summaries: the sum of every known rise between two
 * exports, and how many members it rests on, how many reset, how many
 * began a new baseline and how many are unknown. Plan section 3.7 and R13:
 * nothing is allocated to a day or week between the exports, no fall is a
 * negative gift, and nothing says what was given.
 *
 * A full view also lists each member's rise, largest first, and each reset,
 * in one interval, and the same summed by account handle (FC-058), since a
 * player's characters are each listed on their own. An aggregate view sees
 * the totals and counts only, with a total hidden when fewer than five
 * members' deltas make it up.
 */
@Injectable()
export class FleetContributionReportService {
  /**
   * Creates an instance of FleetContributionReportService.
   *
   * @param _intervals - Each revision's interval summaries.
   * @param _changes - Each revision's changes.
   * @param _names - Names members as exports listed them.
   */
  constructor(
    @InjectRepository(RosterIntervalSummaryEntity)
    private readonly _intervals: Repository<RosterIntervalSummaryEntity>,
    @InjectRepository(RosterChangeEntity)
    private readonly _changes: Repository<RosterChangeEntity>,
    private readonly _names: RosterMemberNameService,
  ) {}

  /**
   * Builds the contribution report.
   *
   * @param context - The revision, span and view.
   * @returns The report, oldest interval first.
   */
  async contribution(
    context: FleetReportContext,
  ): Promise<FleetContributionReportDto> {
    const { header, exports, at } = context;
    const intervals =
      exports.length === 0
        ? []
        : await this._intervals.find({
            where: {
              fleetId: context.fleetId,
              revision: header.revision,
              toImportId: In(exports.map(entry => entry.importId)),
            },
            order: { toAt: 'ASC' },
          });
    const aggregate = header.view === FleetReportView.AGGREGATE;
    const members =
      at === null ? null : await this.members(context, at.importId);

    return {
      ...header,
      intervals: intervals.map(interval =>
        aggregate ? suppressRow(toRow(interval)) : toRow(interval),
      ),
      at:
        at === null
          ? null
          : { importId: at.importId, exportedAt: at.exportedAt },
      members,
      accounts: members === null ? null : accountsOf(members),
    };
  }

  /**
   * Lists each member's rise and reset revealed at one export.
   *
   * @param context - The revision.
   * @param importId - The export ending the interval.
   * @returns The rises, largest first, then the resets, each by name.
   */
  private async members(
    context: FleetReportContext,
    importId: string,
  ): Promise<ContributionMemberDto[]> {
    const changes = await this._changes.find({
      where: {
        fleetId: context.fleetId,
        revision: context.header.revision,
        toImportId: importId,
        kind: In([
          RosterChangeKind.CONTRIBUTION_CHANGED,
          RosterChangeKind.CONTRIBUTION_RESET,
        ]),
      },
    });
    const names = await this._names.names(
      context.fleetId,
      changes.map(change => ({
        importId: change.toImportId,
        identityId: change.identityId,
      })),
    );

    return changes
      .map(change => ({
        identityId: change.identityId,
        member:
          names.get(
            rosterMemberKey({
              importId: change.toImportId,
              identityId: change.identityId,
            }),
          ) ?? null,
        kind: change.kind,
        delta: change.contributionDelta,
        fromContribution: change.detail.fromContribution ?? null,
        toContribution: change.detail.toContribution ?? null,
        from:
          change.fromImportId === null || change.fromAt === null
            ? null
            : { importId: change.fromImportId, exportedAt: change.fromAt },
        acrossGap: change.acrossGap,
      }))
      .sort(largestFirst);
  }
}

/**
 * Orders rises largest first, then resets, each then by name.
 *
 * @param a - One member.
 * @param b - The other.
 * @returns Their order.
 */
function largestFirst(
  a: ContributionMemberDto,
  b: ContributionMemberDto,
): number {
  if ((a.delta === null) !== (b.delta === null)) {
    return a.delta === null ? 1 : -1;
  }

  if (a.delta !== null && b.delta !== null && a.delta !== b.delta) {
    return BigInt(b.delta) > BigInt(a.delta) ? 1 : -1;
  }

  return (
    compareText(a.member?.characterName ?? '', b.member?.characterName ?? '') ||
    compareText(a.identityId, b.identityId)
  );
}

/**
 * Sums the members' rises and resets by account handle (FC-058).
 *
 * Handles are folded as identities are matched, so a handle the game wrote
 * in two cases is one account, named as the later export wrote it for the
 * character listed first: the one with the largest rise, since the members
 * come largest first. A member no export named has no handle to sit under,
 * and is left out. A rise across a gap is summed and counted, as the member
 * list shows it, though no interval's total holds it.
 *
 * @param members - The members, largest rise first, then the resets.
 * @returns One row an account, largest rise first, then by handle.
 */
function accountsOf(
  members: readonly ContributionMemberDto[],
): ContributionAccountDto[] {
  const accounts = new Map<string, ContributionAccountDto>();

  for (const member of members) {
    if (member.member === null) {
      continue;
    }

    const key = normaliseRosterAccountHandle(member.member.accountHandle);
    const account = accounts.get(key) ?? {
      accountHandle: member.member.accountHandle,
      characters: 0,
      delta: '0',
      resets: 0,
      acrossGap: 0,
    };

    account.characters += 1;
    if (member.delta === null) {
      account.resets += 1;
    } else {
      account.delta = (BigInt(account.delta) + BigInt(member.delta)).toString();
    }
    if (member.acrossGap) {
      account.acrossGap += 1;
    }
    accounts.set(key, account);
  }

  return [...accounts.values()].sort(largestAccountFirst);
}

/**
 * Orders accounts largest rise first, then by handle.
 *
 * @param a - One account.
 * @param b - The other.
 * @returns Their order.
 */
function largestAccountFirst(
  a: ContributionAccountDto,
  b: ContributionAccountDto,
): number {
  if (a.delta !== b.delta) {
    return BigInt(b.delta) > BigInt(a.delta) ? 1 : -1;
  }

  return compareText(a.accountHandle, b.accountHandle);
}

/**
 * Maps an interval summary to a contribution row.
 *
 * @param interval - The summary.
 * @returns The row, unsuppressed.
 */
function toRow(interval: RosterIntervalSummaryEntity): ContributionIntervalDto {
  return {
    from: { importId: interval.fromImportId, exportedAt: interval.fromAt },
    to: { importId: interval.toImportId, exportedAt: interval.toAt },
    partial: interval.partial,
    contributionDelta: interval.contributionDelta,
    known: interval.contributionKnown,
    reset: interval.contributionReset,
    baseline: interval.contributionBaseline,
    unknown: interval.contributionUnknown,
  };
}

/**
 * Hides a contribution row's small figures from an aggregate audience.
 *
 * The four counts account for every member at either end exactly once, so
 * they are one group. The total is hidden when fewer than five members'
 * deltas make it up, whatever the counts show.
 *
 * @param row - The row.
 * @returns It with its small figures null.
 */
function suppressRow(row: ContributionIntervalDto): ContributionIntervalDto {
  const known = row.known as number;
  const [shownKnown, reset, baseline, unknown] = suppressGroup([
    known,
    row.reset as number,
    row.baseline as number,
    row.unknown as number,
  ]);

  return {
    ...row,
    contributionDelta:
      known < REPORT_MINIMUM_COHORT ? null : row.contributionDelta,
    known: shownKnown,
    reset,
    baseline,
    unknown,
  };
}
