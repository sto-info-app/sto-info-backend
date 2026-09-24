import { RosterChangeKind } from '../enums/roster-change-kind.enum';
import { RosterEpisodeEnd } from '../enums/roster-episode-end.enum';
import { RosterEpisodeStart } from '../enums/roster-episode-start.enum';

/** What the projector needs of one roster row. Nothing it does not use. */
export interface ProjectorRow {
  /** The roster identity the row's exact name and handle belong to. */
  readonly identityId: string;
  /** The alias the row is, so a change of name or handle can be seen. */
  readonly aliasId: string;
  /** The Character name, exactly as exported. */
  readonly characterName: string;
  /** The account handle, exactly as exported. */
  readonly accountHandle: string;
  /** The Fleet's rank label, exactly as exported. */
  readonly guildRank: string;
  /** The cumulative contribution, as the decimal string a bigint reads as. */
  readonly contributionTotal: string;
  /** When the game says they joined, or null where the export left it out. */
  readonly joinedAt: Date | null;
  /** Whether that instant was one of two, on a morning a clock went back. */
  readonly joinedAtAmbiguous: boolean;
}

/** One effective export, as the projector reads it. */
export interface ProjectorSnapshot {
  /** The import it was read from. */
  readonly importId: string;
  /** The instant its export was taken. */
  readonly exportedAt: Date;
  /**
   * Whether an investigator said it may not list everybody. Nobody missing
   * from a partial export is taken to have left.
   */
  readonly partial: boolean;
  /** Its rows that count: every row an investigator has not excluded. */
  readonly rows: readonly ProjectorRow[];
  /**
   * The identities an excluded row names. Each is unknown in this export —
   * neither present nor absent — unless another of its rows counts.
   */
  readonly unknownIdentityIds: readonly string[];
}

/** An export a result is bounded by. */
export interface ProjectorBound {
  /** The import. */
  readonly importId: string;
  /** Its export instant. */
  readonly at: Date;
}

/** One stretch of one identity's membership, as the exports show it. */
export interface ProjectedEpisode {
  /** The identity. */
  readonly identityId: string;
  /** Which of the identity's episodes this is, from one. */
  readonly ordinal: number;
  /** How it is known to have begun. */
  readonly startKind: RosterEpisodeStart;
  /**
   * The latest export known not to have listed them before it began, or
   * null when none is — a FIRST_SEEN episode, or a rejoin seen only in the
   * Join Date, whose lower bound is the last export of the episode before.
   */
  readonly startedAfter: ProjectorBound | null;
  /** The first export that listed them in it. */
  readonly first: ProjectorBound;
  /** The Join Date the game reported on that first export. */
  readonly reportedJoinedAt: Date | null;
  /** Whether that Join Date was one of two instants. */
  readonly reportedJoinedAtAmbiguous: boolean;
  /** The last export that listed them in it. */
  readonly last: ProjectorBound;
  /** How it is known to have ended, or null while it is open. */
  readonly endKind: RosterEpisodeEnd | null;
  /**
   * The instant it had ended by: the export that did not list them, for
   * LEFT, or the next episode's reported Join Date, for LEFT_AND_REJOINED.
   * Null while open.
   */
  readonly endedBefore: Date | null;
  /** For LEFT, the export that did not list them; otherwise null. */
  readonly endedBeforeImportId: string | null;
  /** The first cumulative contribution known in it: its baseline. */
  readonly baselineContribution: string | null;
  /**
   * The last cumulative contribution known in it. For an ended episode this
   * is the last one observed, never a final total: a leaver's is unknown.
   */
  readonly lastObservedContribution: string | null;
}

/** What a change says, beyond its kind and its bounds. */
export interface ProjectedChangeDetail {
  /** For RENAMED, the name and handle before. */
  readonly fromCharacterName?: string;
  readonly fromAccountHandle?: string;
  /** For RENAMED, the name and handle after. */
  readonly toCharacterName?: string;
  readonly toAccountHandle?: string;
  /** For RANK_CHANGED, the labels before and after. */
  readonly fromRank?: string;
  readonly toRank?: string;
  /** For JOIN_DATE_CHANGED, the Join Dates before and after, ISO 8601. */
  readonly fromJoinedAt?: string;
  readonly toJoinedAt?: string;
  /** For a contribution change or reset, the totals either side. */
  readonly fromContribution?: string;
  readonly toContribution?: string;
  /** For JOINED, REJOINED or LEFT_AND_REJOINED's REJOINED, the baseline. */
  readonly baselineContribution?: string;
}

/** One change to one member, bounded by the two exports it lies between. */
export interface ProjectedChange {
  /** The identity. */
  readonly identityId: string;
  /** The ordinal of the episode it belongs to. */
  readonly episodeOrdinal: number;
  /** What changed. */
  readonly kind: RosterChangeKind;
  /**
   * The export it happened after, or null when no export bounds it below.
   * Always the latest export known to show the earlier state.
   */
  readonly from: ProjectorBound | null;
  /** The export it happened by. */
  readonly to: ProjectorBound;
  /**
   * Whether its bounds are wider than one interval: the export before
   * `to` did not show the earlier state, because the member was unknown in
   * it. Such a change is never counted in an interval's summary.
   */
  readonly acrossGap: boolean;
  /** For CONTRIBUTION_CHANGED, the rise, as a decimal string. */
  readonly contributionDelta: string | null;
  /** What it says beyond that. */
  readonly detail: ProjectedChangeDetail;
}

/** What happened between two consecutive effective exports. */
export interface ProjectedInterval {
  /** The earlier export. */
  readonly from: ProjectorBound;
  /** The later export. */
  readonly to: ProjectorBound;
  /** Whether the later export is partial. */
  readonly partial: boolean;
  /** Identities the earlier export listed. */
  readonly membersAtStart: number;
  /** Identities the later export listed. */
  readonly membersAtEnd: number;
  /** Episodes that began within this interval, for the first time. */
  readonly joined: number;
  /** Episodes that began within this interval, after an earlier one. */
  readonly rejoined: number;
  /** Episodes that ended within this interval. */
  readonly left: number;
  /** Members in an open episode whom the later export leaves unknown. */
  readonly unknown: number;
  /** Renames within this interval. */
  readonly renamed: number;
  /** Rank label changes within this interval. */
  readonly rankChanged: number;
  /** Join Date changes within this interval. */
  readonly joinDateChanged: number;
  /**
   * Changes that became known at the later export but are bounded more
   * widely than this interval, each with its own row, and members first seen
   * there whom no earlier export bounds. None is counted above.
   */
  readonly acrossGap: number;
  /** The sum of every known, non-negative delta within this interval. */
  readonly contributionDelta: string;
  /** Members with such a delta, zero included. */
  readonly contributionKnown: number;
  /** Members whose total fell within this interval. */
  readonly contributionReset: number;
  /** Members whose episode began at the later export, with a known total. */
  readonly contributionBaseline: number;
  /**
   * Every other member listed at either end: a leaver, somebody unknown at
   * one end, a delta spanning more than this interval, an unknown total.
   */
  readonly contributionUnknown: number;
}

/** Everything a Fleet's effective exports amount to. */
export interface RosterProjection {
  /** Every episode, by identity and ordinal. */
  readonly episodes: readonly ProjectedEpisode[];
  /** Every change, in the order the exports show them. */
  readonly changes: readonly ProjectedChange[];
  /** One summary per pair of consecutive effective exports. */
  readonly intervals: readonly ProjectedInterval[];
}

/** One identity as one export lists it, several rows reduced to one. */
interface Sighting {
  readonly index: number;
  readonly bound: ProjectorBound;
  /** Null when the identity's rows disagree, or one of them was excluded. */
  readonly aliasId: string | null;
  readonly characterName: string | null;
  readonly accountHandle: string | null;
  readonly rank: string | null;
  readonly contribution: bigint | null;
  /** Null when absent, ambiguous or disagreeing: never a time claim then. */
  readonly joinedAt: Date | null;
  readonly reportedJoinedAt: Date | null;
  readonly reportedJoinedAtAmbiguous: boolean;
}

/** An episode while it is being put together. */
interface EpisodeDraft {
  ordinal: number;
  startKind: RosterEpisodeStart;
  startedAfter: ProjectorBound | null;
  first: ProjectorBound;
  reportedJoinedAt: Date | null;
  reportedJoinedAtAmbiguous: boolean;
  last: ProjectorBound;
  endKind: RosterEpisodeEnd | null;
  endedBefore: Date | null;
  endedBeforeImportId: string | null;
  baseline: bigint | null;
  lastValue: bigint | null;
}

/** What is known of one identity so far. */
interface Track {
  readonly identityId: string;
  readonly episodes: EpisodeDraft[];
  open: EpisodeDraft | null;
  /** The last export that listed it. */
  lastSeen: Sighting | null;
  /** In the open episode, the last sighting with each value known. */
  lastAlias: Sighting | null;
  lastRank: Sighting | null;
  lastJoin: Sighting | null;
  lastValue: Sighting | null;
}

/** An interval's counts while they are being added up. */
interface IntervalDraft {
  joined: number;
  rejoined: number;
  left: number;
  unknown: number;
  renamed: number;
  rankChanged: number;
  joinDateChanged: number;
  acrossGap: number;
  contributionDelta: bigint;
  contributionKnown: number;
  contributionReset: number;
  contributionBaseline: number;
  contributionUnknown: number;
}

/**
 * Works out a Fleet's membership episodes, changes and interval summaries
 * from its effective exports (FC-019).
 *
 * Pure: no database, no clock. The same set of exports gives the same
 * projection whatever order they arrive in, because they are sorted here by
 * export instant and import, and every identity is visited in identifier
 * order. That is the first acceptance criterion, and it holds by
 * construction rather than by care.
 *
 * ## What the exports can and cannot say — plan section 3.6
 *
 * - **Presence is evidence; absence only from a complete export.** A member
 *   missing from a partial export, or whose row an investigator excluded, is
 *   unknown there, and an unknown never ends an episode.
 * - **A departure is bounded, not dated.** It lies between the last export
 *   that listed them and the first complete one that did not.
 * - **A Join Date after the previous export means they left and came back**
 *   between the two: Steve's decision of 25 September 2026. The old episode
 *   ends and a new one begins with a new baseline. Any other change of Join
 *   Date is recorded and keeps the episode. An ambiguous Join Date is never
 *   a time claim, so never a rejoin.
 * - **A contribution delta is later minus earlier, within one episode, when
 *   it is not negative.** A fall is a reset: a discontinuity with the later
 *   total as a new baseline, never a negative donation. Nothing is carried
 *   across a rejoin, and a leaver's final total is unknown.
 * - **Nothing is allocated between exports.** A delta across an export where
 *   the member was unknown is recorded once, bounded by the two exports it
 *   lies between, and counted in no interval's total.
 * - **Several rows for one identity in one export** — two aliases a
 *   confirmed rename joined, both still listed — show presence, but no value
 *   they disagree on is taken from either.
 */
export class RosterProjector {
  /**
   * Projects a set of effective exports.
   *
   * @param snapshots - The exports, in any order.
   * @returns The episodes, changes and interval summaries.
   * @throws Error if two exports claim one instant: only one export of a
   *   moment is ever effective, and the caller decides which.
   */
  project(snapshots: readonly ProjectorSnapshot[]): RosterProjection {
    const ordered = [...snapshots].sort(
      (a, b) =>
        a.exportedAt.getTime() - b.exportedAt.getTime() ||
        compareText(a.importId, b.importId),
    );

    for (let index = 1; index < ordered.length; index += 1) {
      if (
        ordered[index].exportedAt.getTime() ===
        ordered[index - 1].exportedAt.getTime()
      ) {
        throw new Error('Only one effective roster export per instant');
      }
    }

    const tracks = new Map<string, Track>();
    const unknownSets = ordered.map(
      snapshot => new Set(snapshot.unknownIdentityIds),
    );
    const changes: ProjectedChange[] = [];
    const intervals: ProjectedInterval[] = [];

    for (let index = 0; index < ordered.length; index += 1) {
      const snapshot = ordered[index];
      const bound = boundOf(snapshot);
      const sightings = this.sightings(snapshot, index, unknownSets[index]);
      // The first export ends no interval. It is counted into one all the
      // same, which is then dropped, so no rule below needs to ask.
      const interval = emptyInterval();
      const openBefore = [...tracks.values()]
        .filter(track => track.open !== null)
        .map(track => track.identityId);
      const visit = [...new Set([...sightings.keys(), ...openBefore])].sort(
        compareText,
      );

      for (const identityId of visit) {
        const track =
          tracks.get(identityId) ??
          tracks
            .set(identityId, {
              identityId,
              episodes: [],
              open: null,
              lastSeen: null,
              lastAlias: null,
              lastRank: null,
              lastJoin: null,
              lastValue: null,
            })
            .get(identityId)!;
        const sighting = sightings.get(identityId);

        if (sighting === undefined) {
          this.missing(
            track,
            snapshot,
            bound,
            index,
            unknownSets[index],
            interval,
            changes,
          );
        } else if (track.open === null) {
          this.arrive(track, sighting, ordered, unknownSets, interval, changes);
        } else {
          this.continueEpisode(track, sighting, interval, changes);
        }
      }

      if (index > 0) {
        const previous = ordered[index - 1];

        intervals.push({
          from: boundOf(previous),
          to: bound,
          partial: snapshot.partial,
          membersAtStart: this.countIdentities(previous),
          membersAtEnd: sightings.size,
          joined: interval.joined,
          rejoined: interval.rejoined,
          left: interval.left,
          unknown: interval.unknown,
          renamed: interval.renamed,
          rankChanged: interval.rankChanged,
          joinDateChanged: interval.joinDateChanged,
          acrossGap: interval.acrossGap,
          contributionDelta: interval.contributionDelta.toString(),
          contributionKnown: interval.contributionKnown,
          contributionReset: interval.contributionReset,
          contributionBaseline: interval.contributionBaseline,
          contributionUnknown: interval.contributionUnknown,
        });
      }
    }

    const episodes = [...tracks.values()]
      .sort((a, b) => compareText(a.identityId, b.identityId))
      .flatMap(track =>
        track.episodes.map(draft => this.finish(track.identityId, draft)),
      );

    return { episodes, changes, intervals };
  }

  /**
   * Reduces an export's rows to one sighting per identity.
   *
   * @param snapshot - The export.
   * @param index - Its position in export order.
   * @param unknown - The identities an excluded row of it names.
   * @returns Each identity it lists, and what it says of them.
   */
  private sightings(
    snapshot: ProjectorSnapshot,
    index: number,
    unknown: ReadonlySet<string>,
  ): Map<string, Sighting> {
    const byIdentity = new Map<string, ProjectorRow[]>();

    for (const row of snapshot.rows) {
      byIdentity.set(row.identityId, [
        ...(byIdentity.get(row.identityId) ?? []),
        row,
      ]);
    }

    const sightings = new Map<string, Sighting>();

    for (const [identityId, rows] of byIdentity) {
      // One row, and no excluded row naming the same identity: every value
      // is what the export said. Anything else is presence and nothing more.
      const single = rows.length === 1 && !unknown.has(identityId);
      const row = rows[0];
      const reported = single ? row.joinedAt : agreed(rows, r => r.joinedAt);

      sightings.set(identityId, {
        index,
        bound: boundOf(snapshot),
        aliasId: single ? row.aliasId : null,
        characterName: single ? row.characterName : null,
        accountHandle: single ? row.accountHandle : null,
        rank: single ? row.guildRank : null,
        contribution: single ? BigInt(row.contributionTotal) : null,
        joinedAt:
          single && !row.joinedAtAmbiguous && row.joinedAt !== null
            ? row.joinedAt
            : null,
        reportedJoinedAt: reported,
        reportedJoinedAtAmbiguous: rows.some(r => r.joinedAtAmbiguous),
      });
    }

    return sightings;
  }

  /**
   * Handles an identity with an open episode that an export does not list.
   *
   * @param track - The identity.
   * @param snapshot - The export.
   * @param bound - The export, as a bound.
   * @param index - Its position in export order.
   * @param unknown - The identities an excluded row of it names.
   * @param interval - The interval it ends.
   * @param changes - Where changes are collected.
   */
  private missing(
    track: Track,
    snapshot: ProjectorSnapshot,
    bound: ProjectorBound,
    index: number,
    unknown: ReadonlySet<string>,
    interval: IntervalDraft,
    changes: ProjectedChange[],
  ): void {
    const open = track.open!;
    const lastSeen = track.lastSeen!;
    const wasListedBefore = lastSeen.index === index - 1;

    if (wasListedBefore) {
      interval.contributionUnknown += 1;
    }

    if (snapshot.partial || unknown.has(track.identityId)) {
      interval.unknown += 1;

      return;
    }

    open.endKind = RosterEpisodeEnd.LEFT;
    open.endedBefore = bound.at;
    open.endedBeforeImportId = bound.importId;
    track.open = null;

    this.record(changes, interval, {
      identityId: track.identityId,
      episodeOrdinal: open.ordinal,
      kind: RosterChangeKind.LEFT,
      from: lastSeen.bound,
      to: bound,
      acrossGap: !wasListedBefore,
      contributionDelta: null,
      detail: {},
    });
  }

  /**
   * Handles an identity an export lists that has no open episode.
   *
   * @param track - The identity.
   * @param sighting - What the export says of it.
   * @param ordered - Every export, in export order.
   * @param unknownSets - Each export's excluded identities.
   * @param interval - The interval the export ends.
   * @param changes - Where changes are collected.
   */
  private arrive(
    track: Track,
    sighting: Sighting,
    ordered: readonly ProjectorSnapshot[],
    unknownSets: ReadonlyArray<ReadonlySet<string>>,
    interval: IntervalDraft,
    changes: ProjectedChange[],
  ): void {
    const startedAfter = this.lastKnownAbsent(
      track,
      sighting.index,
      ordered,
      unknownSets,
    );
    const startKind =
      track.episodes.length > 0
        ? RosterEpisodeStart.REJOINED
        : startedAfter === null
          ? RosterEpisodeStart.FIRST_SEEN
          : RosterEpisodeStart.JOINED;
    const draft = this.open(track, sighting, startKind, startedAfter);

    this.countBaseline(interval, sighting);

    if (startKind === RosterEpisodeStart.FIRST_SEEN) {
      // No export bounds the arrival below, so it cannot be put in this
      // interval, and the Fleet's first export is not a wave of joins.
      interval.acrossGap += 1;

      return;
    }

    this.record(changes, interval, {
      identityId: track.identityId,
      episodeOrdinal: draft.ordinal,
      kind:
        startKind === RosterEpisodeStart.REJOINED
          ? RosterChangeKind.REJOINED
          : RosterChangeKind.JOINED,
      from: startedAfter,
      to: sighting.bound,
      // Found at or before the export immediately before this one.
      acrossGap:
        startedAfter!.importId !== ordered[sighting.index - 1].importId,
      contributionDelta: null,
      detail: baselineDetail(sighting),
    });
  }

  /**
   * Handles an identity an export lists that has an open episode.
   *
   * @param track - The identity.
   * @param sighting - What the export says of it.
   * @param interval - The interval the export ends.
   * @param changes - Where changes are collected.
   */
  private continueEpisode(
    track: Track,
    sighting: Sighting,
    interval: IntervalDraft,
    changes: ProjectedChange[],
  ): void {
    const open = track.open!;
    const lastSeen = track.lastSeen!;

    // A Join Date after the last export that listed them: they left and
    // came back in between.
    if (
      sighting.joinedAt !== null &&
      sighting.joinedAt.getTime() > lastSeen.bound.at.getTime()
    ) {
      const acrossGap = lastSeen.index !== sighting.index - 1;

      open.endKind = RosterEpisodeEnd.LEFT_AND_REJOINED;
      open.endedBefore = sighting.joinedAt;
      open.endedBeforeImportId = null;
      track.open = null;

      this.record(changes, interval, {
        identityId: track.identityId,
        episodeOrdinal: open.ordinal,
        kind: RosterChangeKind.LEFT,
        from: lastSeen.bound,
        to: sighting.bound,
        acrossGap,
        contributionDelta: null,
        detail: {},
      });

      const draft = this.open(
        track,
        sighting,
        RosterEpisodeStart.REJOINED,
        null,
      );

      this.countBaseline(interval, sighting);

      this.record(changes, interval, {
        identityId: track.identityId,
        episodeOrdinal: draft.ordinal,
        kind: RosterChangeKind.REJOINED,
        from: lastSeen.bound,
        to: sighting.bound,
        acrossGap,
        contributionDelta: null,
        detail: baselineDetail(sighting),
      });

      return;
    }

    open.last = sighting.bound;
    track.lastSeen = sighting;

    const change = (
      earlier: Sighting,
      kind: RosterChangeKind,
      detail: ProjectedChangeDetail,
      contributionDelta: string | null = null,
    ): void =>
      this.record(changes, interval, {
        identityId: track.identityId,
        episodeOrdinal: open.ordinal,
        kind,
        from: earlier.bound,
        to: sighting.bound,
        acrossGap: earlier.index !== sighting.index - 1,
        contributionDelta,
        detail,
      });

    if (sighting.aliasId !== null) {
      const earlier = track.lastAlias;

      if (earlier !== null && earlier.aliasId !== sighting.aliasId) {
        change(earlier, RosterChangeKind.RENAMED, {
          fromCharacterName: earlier.characterName!,
          fromAccountHandle: earlier.accountHandle!,
          toCharacterName: sighting.characterName!,
          toAccountHandle: sighting.accountHandle!,
        });
      }

      track.lastAlias = sighting;
    }

    if (sighting.rank !== null) {
      const earlier = track.lastRank;

      if (earlier !== null && earlier.rank !== sighting.rank) {
        change(earlier, RosterChangeKind.RANK_CHANGED, {
          fromRank: earlier.rank!,
          toRank: sighting.rank,
        });
      }

      track.lastRank = sighting;
    }

    if (sighting.joinedAt !== null) {
      const earlier = track.lastJoin;

      if (
        earlier !== null &&
        earlier.joinedAt!.getTime() !== sighting.joinedAt.getTime()
      ) {
        change(earlier, RosterChangeKind.JOIN_DATE_CHANGED, {
          fromJoinedAt: earlier.joinedAt!.toISOString(),
          toJoinedAt: sighting.joinedAt.toISOString(),
        });
      }

      track.lastJoin = sighting;
    }

    this.contribution(track, sighting, interval, change);
  }

  /**
   * Compares a continuing member's contribution with the last one known.
   *
   * @param track - The identity.
   * @param sighting - What the export says of it.
   * @param interval - The interval the export ends.
   * @param change - Records a change against an earlier sighting.
   */
  private contribution(
    track: Track,
    sighting: Sighting,
    interval: IntervalDraft,
    change: (
      earlier: Sighting,
      kind: RosterChangeKind,
      detail: ProjectedChangeDetail,
      contributionDelta?: string | null,
    ) => void,
  ): void {
    const open = track.open!;
    const earlier = track.lastValue;
    const value = sighting.contribution;
    const bounded =
      earlier !== null &&
      earlier.index === sighting.index - 1 &&
      value !== null;

    if (value === null || earlier === null) {
      interval.contributionUnknown += 1;

      if (value !== null) {
        open.baseline ??= value;
        open.lastValue = value;
        track.lastValue = sighting;
      }

      return;
    }

    const delta = value - earlier.contribution!;
    const totals = {
      fromContribution: earlier.contribution!.toString(),
      toContribution: value.toString(),
    };

    if (delta < 0n) {
      change(earlier, RosterChangeKind.CONTRIBUTION_RESET, totals);
    } else if (delta > 0n) {
      change(
        earlier,
        RosterChangeKind.CONTRIBUTION_CHANGED,
        totals,
        delta.toString(),
      );
    }

    if (!bounded) {
      interval.contributionUnknown += 1;
    } else if (delta < 0n) {
      interval.contributionReset += 1;
    } else {
      interval.contributionKnown += 1;
      interval.contributionDelta += delta;
    }

    open.lastValue = value;
    track.lastValue = sighting;
  }

  /**
   * Begins an episode.
   *
   * @param track - The identity.
   * @param sighting - The export that first lists them in it.
   * @param startKind - How it is known to have begun.
   * @param startedAfter - The latest export known not to have listed them.
   * @returns The new episode.
   */
  private open(
    track: Track,
    sighting: Sighting,
    startKind: RosterEpisodeStart,
    startedAfter: ProjectorBound | null,
  ): EpisodeDraft {
    const draft: EpisodeDraft = {
      ordinal: track.episodes.length + 1,
      startKind,
      startedAfter,
      first: sighting.bound,
      reportedJoinedAt: sighting.reportedJoinedAt,
      reportedJoinedAtAmbiguous: sighting.reportedJoinedAtAmbiguous,
      last: sighting.bound,
      endKind: null,
      endedBefore: null,
      endedBeforeImportId: null,
      baseline: sighting.contribution,
      lastValue: sighting.contribution,
    };

    track.episodes.push(draft);
    track.open = draft;
    track.lastSeen = sighting;
    track.lastAlias = sighting.aliasId === null ? null : sighting;
    track.lastRank = sighting.rank === null ? null : sighting;
    track.lastJoin = sighting.joinedAt === null ? null : sighting;
    track.lastValue = sighting.contribution === null ? null : sighting;

    return draft;
  }

  /**
   * Finds the latest complete export, before an arrival and after the
   * identity was last listed, that shows it absent.
   *
   * Scans back from the arrival and stops at the first such export, which is
   * usually the one immediately before.
   *
   * @param track - The identity.
   * @param index - The arriving export's position.
   * @param ordered - Every export, in export order.
   * @param unknownSets - Each export's excluded identities.
   * @returns That export, or null when none shows it absent.
   */
  private lastKnownAbsent(
    track: Track,
    index: number,
    ordered: readonly ProjectorSnapshot[],
    unknownSets: ReadonlyArray<ReadonlySet<string>>,
  ): ProjectorBound | null {
    const stop = track.lastSeen?.index ?? -1;

    for (let at = index - 1; at > stop; at -= 1) {
      if (!ordered[at].partial && !unknownSets[at].has(track.identityId)) {
        return boundOf(ordered[at]);
      }
    }

    return null;
  }

  /**
   * Counts an arrival's contribution in an interval.
   *
   * @param interval - The interval.
   * @param sighting - The arrival.
   */
  private countBaseline(interval: IntervalDraft, sighting: Sighting): void {
    if (sighting.contribution === null) {
      interval.contributionUnknown += 1;
    } else {
      interval.contributionBaseline += 1;
    }
  }

  /**
   * Records a change, and counts it in the interval when it lies within it.
   *
   * @param changes - Where changes are collected.
   * @param interval - The interval the change became known in.
   * @param change - The change.
   */
  private record(
    changes: ProjectedChange[],
    interval: IntervalDraft,
    change: ProjectedChange,
  ): void {
    changes.push(change);

    if (change.acrossGap) {
      interval.acrossGap += 1;

      return;
    }

    switch (change.kind) {
      case RosterChangeKind.JOINED:
        interval.joined += 1;
        break;
      case RosterChangeKind.REJOINED:
        interval.rejoined += 1;
        break;
      case RosterChangeKind.LEFT:
        interval.left += 1;
        break;
      case RosterChangeKind.RENAMED:
        interval.renamed += 1;
        break;
      case RosterChangeKind.RANK_CHANGED:
        interval.rankChanged += 1;
        break;
      case RosterChangeKind.JOIN_DATE_CHANGED:
        interval.joinDateChanged += 1;
        break;
      default:
        // Contribution changes are counted by value, not by row.
        break;
    }
  }

  /**
   * How many identities an export lists.
   *
   * @param snapshot - The export.
   * @returns The count, several rows for one identity counted once.
   */
  private countIdentities(snapshot: ProjectorSnapshot): number {
    return new Set(snapshot.rows.map(row => row.identityId)).size;
  }

  /**
   * Turns an episode draft into the episode it describes.
   *
   * @param identityId - The identity.
   * @param draft - The draft.
   * @returns The episode.
   */
  private finish(identityId: string, draft: EpisodeDraft): ProjectedEpisode {
    return {
      identityId,
      ordinal: draft.ordinal,
      startKind: draft.startKind,
      startedAfter: draft.startedAfter,
      first: draft.first,
      reportedJoinedAt: draft.reportedJoinedAt,
      reportedJoinedAtAmbiguous: draft.reportedJoinedAtAmbiguous,
      last: draft.last,
      endKind: draft.endKind,
      endedBefore: draft.endedBefore,
      endedBeforeImportId: draft.endedBeforeImportId,
      baselineContribution: draft.baseline?.toString() ?? null,
      lastObservedContribution: draft.lastValue?.toString() ?? null,
    };
  }
}

/**
 * An export as a bound.
 *
 * @param snapshot - The export.
 * @returns Its import and instant.
 */
function boundOf(snapshot: ProjectorSnapshot): ProjectorBound {
  return { importId: snapshot.importId, at: snapshot.exportedAt };
}

/**
 * An interval with nothing counted yet.
 *
 * @returns The empty counts.
 */
function emptyInterval(): IntervalDraft {
  return {
    joined: 0,
    rejoined: 0,
    left: 0,
    unknown: 0,
    renamed: 0,
    rankChanged: 0,
    joinDateChanged: 0,
    acrossGap: 0,
    contributionDelta: 0n,
    contributionKnown: 0,
    contributionReset: 0,
    contributionBaseline: 0,
    contributionUnknown: 0,
  };
}

/**
 * The detail an arrival's change carries.
 *
 * @param sighting - The arrival.
 * @returns Its baseline, when known.
 */
function baselineDetail(sighting: Sighting): ProjectedChangeDetail {
  return sighting.contribution === null
    ? {}
    : { baselineContribution: sighting.contribution.toString() };
}

/**
 * The instant several rows agree on, or null when they do not.
 *
 * @param rows - The rows.
 * @param read - Reads the instant from a row.
 * @returns The shared instant, or null.
 */
function agreed(
  rows: readonly ProjectorRow[],
  read: (row: ProjectorRow) => Date | null,
): Date | null {
  const first = read(rows[0]);

  return rows.every(row => read(row)?.getTime() === first?.getTime())
    ? first
    : null;
}

/**
 * Orders two strings by code unit, the same in every locale.
 *
 * @param a - One string.
 * @param b - The other.
 * @returns Negative, zero or positive.
 */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
