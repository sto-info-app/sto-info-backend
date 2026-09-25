import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { RosterChangeEntity } from '../../projection/entities/roster-change.entity';
import { RosterIntervalSummaryEntity } from '../../projection/entities/roster-interval-summary.entity';
import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';
import { compareText } from '../../projection/utilities/compare-text.utility';
import {
  ROSTER_HISTORY_KINDS,
  ROSTER_HISTORY_PAGE_SIZE,
  RosterHistoryQueryDto,
} from '../dto/roster-history-query.dto';
import {
  RosterChangeDto,
  RosterHistoryPageDto,
  RosterIntervalDto,
} from '../dto/roster-history.dto';
import { toRosterChangeDto } from '../utilities/roster-change.mapper';
import { PublishedRosterRevisionService } from './published-roster-revision.service';
import {
  rosterMemberKey,
  RosterMemberNameService,
} from './roster-member-name.service';
import { RosterRankOrderService } from './roster-rank-order.service';

/**
 * Reads a Fleet's roster history, interval by interval (FC-020).
 *
 * For `roster.view` holders. Each interval between two consecutive effective
 * exports is shown with its summary and the membership, name, rank and Join
 * Date changes that the later export revealed, newest first (Steve's
 * decisions of 25 September 2026). A change across a gap sits under the
 * export that revealed it, with its wider bounds, and is in none of the
 * interval's totals — FC-019 counted it in none.
 *
 * Contribution appears here only as each interval's totals and counts: a
 * member's rises and resets are on their timeline and in the contribution
 * report.
 */
@Injectable()
export class RosterHistoryService {
  /**
   * Creates an instance of RosterHistoryService.
   *
   * @param _revisions - Pins the reader to the published revision.
   * @param _intervals - Each revision's interval summaries.
   * @param _changes - Each revision's changes.
   * @param _names - Names members as exports listed them.
   * @param _rankOrder - Reads the Fleet's rank order.
   */
  constructor(
    private readonly _revisions: PublishedRosterRevisionService,
    @InjectRepository(RosterIntervalSummaryEntity)
    private readonly _intervals: Repository<RosterIntervalSummaryEntity>,
    @InjectRepository(RosterChangeEntity)
    private readonly _changes: Repository<RosterChangeEntity>,
    private readonly _names: RosterMemberNameService,
    private readonly _rankOrder: RosterRankOrderService,
  ) {}

  /**
   * Reads one page of a Fleet's history.
   *
   * @param fleetId - The Fleet.
   * @param query - The page and kinds asked for.
   * @returns The page, newest interval first, with the revision read.
   */
  async page(
    fleetId: string,
    query: RosterHistoryQueryDto,
  ): Promise<RosterHistoryPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? ROSTER_HISTORY_PAGE_SIZE;
    const pinned = await this._revisions.pin(fleetId);

    if (pinned.revision === 0) {
      return { ...pinned, items: [], total: 0, page, pageSize };
    }

    const [intervals, total] = await this._intervals.findAndCount({
      where: { fleetId, revision: pinned.revision },
      order: { toAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    if (intervals.length === 0) {
      return { ...pinned, items: [], total, page, pageSize };
    }

    const changes = await this._changes.find({
      where: {
        fleetId,
        revision: pinned.revision,
        toImportId: In(intervals.map(interval => interval.toImportId)),
        kind: In([...(query.kinds ?? ROSTER_HISTORY_KINDS)]),
      },
    });
    const tiers = await this._rankOrder.tiers(fleetId);
    const names = await this._names.names(fleetId, changes.map(shownAt));
    const byInterval = new Map<string, RosterChangeDto[]>();

    for (const change of changes) {
      const mapped = toRosterChangeDto(
        change,
        tiers,
        names.get(rosterMemberKey(shownAt(change))) ?? null,
        false,
      );
      const listed = byInterval.get(change.toImportId) ?? [];

      listed.push(mapped);
      byInterval.set(change.toImportId, listed);
    }

    return {
      ...pinned,
      items: intervals.map(interval =>
        toIntervalDto(
          interval,
          (byInterval.get(interval.toImportId) ?? []).sort(byKindThenName),
        ),
      ),
      total,
      page,
      pageSize,
    };
  }
}

/** The order kinds are listed in within an interval. */
const KIND_ORDER = new Map(
  [
    RosterChangeKind.JOINED,
    RosterChangeKind.REJOINED,
    RosterChangeKind.LEFT,
    RosterChangeKind.RENAMED,
    RosterChangeKind.RANK_CHANGED,
    RosterChangeKind.JOIN_DATE_CHANGED,
    RosterChangeKind.CONTRIBUTION_CHANGED,
    RosterChangeKind.CONTRIBUTION_RESET,
  ].map((kind, index) => [kind, index]),
);

/**
 * Orders an interval's changes by kind, then by the member's name.
 *
 * @param a - One change.
 * @param b - The other.
 * @returns Their order.
 */
function byKindThenName(a: RosterChangeDto, b: RosterChangeDto): number {
  return (
    (KIND_ORDER.get(a.kind) as number) - (KIND_ORDER.get(b.kind) as number) ||
    compareText(a.member?.characterName ?? '', b.member?.characterName ?? '') ||
    compareText(a.identityId, b.identityId)
  );
}

/**
 * Says which export shows a change's member: the later one, or for a
 * departure the earlier, since the later does not list them.
 *
 * @param change - The change.
 * @returns The export and member to name it by.
 */
function shownAt(change: RosterChangeEntity): {
  importId: string;
  identityId: string;
} {
  return {
    importId:
      change.kind === RosterChangeKind.LEFT && change.fromImportId !== null
        ? change.fromImportId
        : change.toImportId,
    identityId: change.identityId,
  };
}

/**
 * Maps an interval summary and its changes for a reader.
 *
 * @param interval - The summary.
 * @param changes - Its changes, in order.
 * @returns The interval.
 */
function toIntervalDto(
  interval: RosterIntervalSummaryEntity,
  changes: RosterChangeDto[],
): RosterIntervalDto {
  return {
    from: { importId: interval.fromImportId, exportedAt: interval.fromAt },
    to: { importId: interval.toImportId, exportedAt: interval.toAt },
    partial: interval.partial,
    membersAtStart: interval.membersAtStart,
    membersAtEnd: interval.membersAtEnd,
    joined: interval.joined,
    rejoined: interval.rejoined,
    left: interval.left,
    unknown: interval.unknown,
    renamed: interval.renamed,
    rankChanged: interval.rankChanged,
    joinDateChanged: interval.joinDateChanged,
    acrossGap: interval.acrossGap,
    contributionDelta: interval.contributionDelta,
    contributionKnown: interval.contributionKnown,
    contributionReset: interval.contributionReset,
    contributionBaseline: interval.contributionBaseline,
    contributionUnknown: interval.contributionUnknown,
    changes,
  };
}
