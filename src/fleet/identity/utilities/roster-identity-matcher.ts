import { RosterIdentityCandidateKind } from '../enums/roster-identity-candidate-kind.enum';
import { RosterIdentityCollisionReason } from '../enums/roster-identity-collision-reason.enum';
import { RosterIdentityConfidence } from '../enums/roster-identity-confidence.enum';
import { RosterIdentitySignal } from '../enums/roster-identity-signal.enum';

/** What the matcher needs of one observation. Nothing it does not use. */
export interface RosterIdentityRow {
  /** The Character name, exactly as exported. */
  readonly characterName: string;
  /** The same name, normalised as the observation stores it. */
  readonly characterNameNormalised: string;
  /** The account handle, exactly as exported. */
  readonly accountHandle: string;
  /** The same handle, normalised as the observation stores it. */
  readonly accountHandleNormalised: string;
  /** The Character's level. */
  readonly level: number;
  /** The Class text, exactly as exported. */
  readonly className: string;
  /** The cumulative contribution, as the decimal string a bigint reads as. */
  readonly contributionTotal: string;
  /** When the game says they joined, or null where the export left it out. */
  readonly joinedAt: Date | null;
  /** Whether that instant was one of two. */
  readonly joinedAtAmbiguous: boolean;
  /** When the game says their rank last changed, or null. */
  readonly rankChangedAt: Date | null;
  /** Whether that instant was one of two. */
  readonly rankChangedAtAmbiguous: boolean;
}

/** One effective export, as the matcher reads it. */
export interface RosterIdentitySnapshot {
  /** The import it was read from. */
  readonly importId: string;
  /** The instant its export was taken. */
  readonly exportedAt: Date;
  /**
   * Its rows that count: one per exact name and handle, as the reader
   * guarantees, less any an investigator excluded.
   */
  readonly rows: readonly RosterIdentityRow[];
  /**
   * Whether it can show a name gone: not marked partial, and with no row
   * excluded. Only complete exports are compared (FC-019).
   */
  readonly complete: boolean;
}

/** One exact name and handle, and when the in-force exports listed it. */
export interface MatchedAlias {
  /** The alias key, from {@link rosterAliasKey}. */
  readonly key: string;
  /** The name as the earliest export listing it wrote it. */
  readonly characterName: string;
  /** The normalised name. */
  readonly characterNameNormalised: string;
  /** The handle as the earliest export listing it wrote it. */
  readonly accountHandle: string;
  /** The normalised handle. */
  readonly accountHandleNormalised: string;
  /** The export instant of the earliest export listing it. */
  readonly firstObservedAt: Date;
  /** The export instant of the latest export listing it. */
  readonly lastObservedAt: Date;
}

/** One pair of aliases a candidate would join, by alias key. */
export interface MatchedLink {
  /** The alias that vanished. */
  readonly fromKey: string;
  /** The alias that appeared. */
  readonly toKey: string;
}

/** A rename the evidence suggests, before it is stored. */
export interface MatchedCandidate {
  /** Which candidate it is, stable across recomputes: see {@link candidateKey}. */
  readonly key: string;
  /** Whether the name or the handle changed. */
  readonly kind: RosterIdentityCandidateKind;
  /** For a Character rename, the alias that vanished. */
  readonly fromAliasKey: string | null;
  /** For a Character rename, the alias that appeared. */
  readonly toAliasKey: string | null;
  /** For an account rename, the normalised handle that vanished. */
  readonly fromHandleNormalised: string | null;
  /** For an account rename, the normalised handle that appeared. */
  readonly toHandleNormalised: string | null;
  /** The export the old name was last seen in. */
  readonly earlierImportId: string;
  /** The export the new name was first seen in. */
  readonly laterImportId: string;
  /** Every alias pair it would join. */
  readonly links: readonly MatchedLink[];
  /** Each corroborating check and how it came out. */
  readonly signals: ReadonlyArray<{
    readonly signal: RosterIdentitySignal;
    readonly held: boolean | null;
  }>;
  /** How much of that held. */
  readonly confidence: RosterIdentityConfidence;
  /** Why it cannot be resolved, in a fixed order. Empty when it can. */
  readonly collisionReasons: readonly RosterIdentityCollisionReason[];
}

/** Everything a Fleet's in-force exports say about its identities. */
export interface RosterIdentityMatch {
  /** Every alias the exports list, by key. */
  readonly aliases: ReadonlyMap<string, MatchedAlias>;
  /** Every candidate, by key. */
  readonly candidates: ReadonlyMap<string, MatchedCandidate>;
}

/** The corroborating checks, in the order they are reported. */
const SIGNALS: readonly RosterIdentitySignal[] = [
  RosterIdentitySignal.LEVEL_NOT_LOWER,
  RosterIdentitySignal.CONTRIBUTION_NOT_LOWER,
  RosterIdentitySignal.RANK_CHANGE_NOT_EARLIER,
];

/** The collision reasons, in the order they are reported. */
const COLLISION_ORDER: readonly RosterIdentityCollisionReason[] = [
  RosterIdentityCollisionReason.SEVERAL_PARTNERS,
  RosterIdentityCollisionReason.OLD_HANDLE_STILL_PRESENT,
  RosterIdentityCollisionReason.NEW_HANDLE_ALREADY_PRESENT,
  RosterIdentityCollisionReason.HANDLE_SPLIT,
  RosterIdentityCollisionReason.HANDLE_MERGE,
  RosterIdentityCollisionReason.LISTED_TOGETHER,
];

/**
 * The key an alias is known by: its normalised name and handle together.
 *
 * JSON rather than a separator character, because no character is safe to
 * put between two strings a user typed, and the one the roster reader uses is
 * a NUL that makes Git treat any file spelling it literally as binary.
 *
 * @param characterNameNormalised - The normalised name.
 * @param accountHandleNormalised - The normalised handle.
 * @returns The key.
 */
export function rosterAliasKey(
  characterNameNormalised: string,
  accountHandleNormalised: string,
): string {
  return JSON.stringify([characterNameNormalised, accountHandleNormalised]);
}

/**
 * The key a candidate is known by, stable across recomputes.
 *
 * A Character rename is the pair of aliases; an account rename is the pair of
 * handles, whichever Characters turn out to cite it. That is also what the
 * database's two partial unique indexes hold unique, so a candidate a reviewer
 * rejected is found again, and not suggested again, however the evidence
 * around it moves.
 *
 * @param kind - Whether the name or the handle changed.
 * @param from - The alias key or handle that vanished.
 * @param to - The alias key or handle that appeared.
 * @returns The key.
 */
export function candidateKey(
  kind: RosterIdentityCandidateKind,
  from: string,
  to: string,
): string {
  return JSON.stringify([kind, from, to]);
}

/** One pair of rows and which kind of rename would relate them. */
interface Pair {
  readonly kind: RosterIdentityCandidateKind;
  readonly from: RosterIdentityRow;
  readonly to: RosterIdentityRow;
}

/** A candidate while it is being put together. */
interface Draft {
  kind: RosterIdentityCandidateKind;
  fromAliasKey: string | null;
  toAliasKey: string | null;
  fromHandleNormalised: string | null;
  toHandleNormalised: string | null;
  earlierImportId: string;
  laterImportId: string;
  links: Map<string, MatchedLink>;
  held: Map<RosterIdentitySignal, boolean | null>;
  collisions: Set<RosterIdentityCollisionReason>;
}

/**
 * Works out a Fleet's roster identities and rename candidates from its
 * effective exports.
 *
 * Pure: no database, no clock. The replay reads every effective import of a
 * Fleet in export order and hands each one to {@link add}, and this keeps only
 * the last complete export and any partial ones since, so a Fleet's whole
 * history is one pass in memory the size of a few exports.
 *
 * ## What makes a candidate — plan section 3.6, decided 24 September 2026
 *
 * Only two consecutive complete exports are ever compared, and only a row in
 * the earlier that is gone from the later against a row in the later that was
 * not in the earlier. An export marked partial, or with a row excluded, cannot
 * show that a name is gone, so it is skipped for pairing and only records the
 * names it lists — Steve's decision of 25 September 2026. Then, as hard
 * gates:
 *
 * - **A Character rename** keeps the handle and changes the name.
 * - **An account rename** keeps the name and changes the handle.
 * - Either way the join instant is present, was not one of two, and is equal,
 *   and the Class text is identical.
 *
 * Nothing is matched on a join date or a name alone: FC-018's first acceptance
 * criterion. Level, contribution and the rank change date are corroboration,
 * graded into the confidence rather than required, because the corpus holds a
 * probable rename whose contribution changed.
 *
 * ## What makes one unresolvable
 *
 * A row that could pair with more than one row on the other side, by either
 * kind of rename, makes every pair it is in a collision: the multi-alt case
 * the acceptance criterion requires to stay unresolved. An account rename is
 * also a collision when the old handle is still in the later export or the new
 * one was already in the earlier — a handle belongs to a whole account, so
 * neither can happen to an account that was renamed — or when the Characters
 * of one handle split between two, or two handles' merge into one. And a pair
 * is a collision when a partial export skipped between the two lists both of
 * its names at once, since then neither replaced the other. A collision is
 * still reported, so that a reviewer can see why nothing was suggested.
 */
export class RosterIdentityMatcher {
  private readonly _aliases = new Map<string, MatchedAlias>();

  private readonly _drafts = new Map<string, Draft>();

  /** The last complete export added. */
  private _previous: RosterIdentitySnapshot | null = null;

  /** Partial exports added since it, each as the alias keys it lists. */
  private _skipped: Array<ReadonlySet<string>> = [];

  /** The instant of the last export added, complete or not. */
  private _lastAt: number | null = null;

  /**
   * Reads the next export, in export order.
   *
   * @param snapshot - The export after the last one added.
   * @throws Error if it is not later than the last one: the matcher compares
   *   neighbours, and neighbours out of order are not neighbours.
   */
  add(snapshot: RosterIdentitySnapshot): void {
    if (
      this._lastAt !== null &&
      snapshot.exportedAt.getTime() <= this._lastAt
    ) {
      throw new Error(
        'Roster exports must be added in export order, one per instant',
      );
    }

    this._lastAt = snapshot.exportedAt.getTime();

    for (const row of snapshot.rows) {
      this.observe(row, snapshot.exportedAt);
    }

    if (!snapshot.complete) {
      // Before the first complete export there is nothing to compare across.
      if (this._previous !== null) {
        this._skipped.push(new Set(snapshot.rows.map(row => this.keyOf(row))));
      }

      return;
    }

    if (this._previous !== null) {
      this.compare(this._previous, snapshot);
    }

    this._previous = snapshot;
    this._skipped = [];
  }

  /**
   * Says what the exports added so far amount to.
   *
   * @returns Every alias and every candidate.
   */
  result(): RosterIdentityMatch {
    const candidates = new Map<string, MatchedCandidate>();

    for (const [key, draft] of this._drafts) {
      const signals = SIGNALS.map(signal => ({
        signal,
        held: draft.held.get(signal) ?? null,
      }));

      candidates.set(key, {
        key,
        kind: draft.kind,
        fromAliasKey: draft.fromAliasKey,
        toAliasKey: draft.toAliasKey,
        fromHandleNormalised: draft.fromHandleNormalised,
        toHandleNormalised: draft.toHandleNormalised,
        earlierImportId: draft.earlierImportId,
        laterImportId: draft.laterImportId,
        links: [...draft.links.values()],
        signals,
        confidence: this.confidence(draft.kind, signals, draft.links.size),
        collisionReasons: COLLISION_ORDER.filter(reason =>
          draft.collisions.has(reason),
        ),
      });
    }

    return { aliases: new Map(this._aliases), candidates };
  }

  /**
   * Records that an export listed one exact name and handle.
   *
   * @param row - The row.
   * @param exportedAt - When the export was taken.
   */
  private observe(row: RosterIdentityRow, exportedAt: Date): void {
    const key = rosterAliasKey(
      row.characterNameNormalised,
      row.accountHandleNormalised,
    );
    const known = this._aliases.get(key);

    this._aliases.set(key, {
      key,
      characterName: known?.characterName ?? row.characterName,
      characterNameNormalised: row.characterNameNormalised,
      accountHandle: known?.accountHandle ?? row.accountHandle,
      accountHandleNormalised: row.accountHandleNormalised,
      firstObservedAt: known?.firstObservedAt ?? exportedAt,
      lastObservedAt: exportedAt,
    });
  }

  /**
   * Compares two consecutive exports and drafts what they suggest.
   *
   * @param earlier - The earlier export.
   * @param later - The later one.
   */
  private compare(
    earlier: RosterIdentitySnapshot,
    later: RosterIdentitySnapshot,
  ): void {
    const earlierKeys = new Set(earlier.rows.map(row => this.keyOf(row)));
    const laterKeys = new Set(later.rows.map(row => this.keyOf(row)));

    const vanished = earlier.rows.filter(
      row => !laterKeys.has(this.keyOf(row)) && this.isMatchable(row),
    );
    const appeared = later.rows.filter(
      row => !earlierKeys.has(this.keyOf(row)) && this.isMatchable(row),
    );

    const pairs = [
      ...this.pairsBy(
        RosterIdentityCandidateKind.CHARACTER_RENAME,
        vanished,
        appeared,
        row => [row.accountHandleNormalised, this.joinAndClass(row)],
      ),
      ...this.pairsBy(
        RosterIdentityCandidateKind.ACCOUNT_RENAME,
        vanished,
        appeared,
        row => [row.characterNameNormalised, this.joinAndClass(row)],
      ),
    ];

    // A row with more than one possible partner, by either kind of rename,
    // cannot be resolved by any of them.
    const partners = new Map<RosterIdentityRow, number>();

    for (const pair of pairs) {
      partners.set(pair.from, (partners.get(pair.from) ?? 0) + 1);
      partners.set(pair.to, (partners.get(pair.to) ?? 0) + 1);
    }

    const ambiguous = (pair: Pair): boolean =>
      partners.get(pair.from)! > 1 || partners.get(pair.to)! > 1;

    const accountPairs = pairs.filter(
      pair => pair.kind === RosterIdentityCandidateKind.ACCOUNT_RENAME,
    );
    const newHandlesOf = new Map<string, Set<string>>();
    const oldHandlesOf = new Map<string, Set<string>>();

    for (const { from, to } of accountPairs) {
      const oldHandle = from.accountHandleNormalised;
      const newHandle = to.accountHandleNormalised;

      newHandlesOf.set(
        oldHandle,
        (newHandlesOf.get(oldHandle) ?? new Set()).add(newHandle),
      );
      oldHandlesOf.set(
        newHandle,
        (oldHandlesOf.get(newHandle) ?? new Set()).add(oldHandle),
      );
    }

    const earlierHandles = new Set(
      earlier.rows.map(row => row.accountHandleNormalised),
    );
    const laterHandles = new Set(
      later.rows.map(row => row.accountHandleNormalised),
    );

    for (const pair of pairs) {
      const draft = this.draftFor(pair, earlier, later);

      this.link(draft, pair);

      if (ambiguous(pair)) {
        draft.collisions.add(RosterIdentityCollisionReason.SEVERAL_PARTNERS);
      }

      if (this.listedTogether(pair)) {
        draft.collisions.add(RosterIdentityCollisionReason.LISTED_TOGETHER);
      }

      if (pair.kind !== RosterIdentityCandidateKind.ACCOUNT_RENAME) {
        continue;
      }

      const oldHandle = pair.from.accountHandleNormalised;
      const newHandle = pair.to.accountHandleNormalised;

      if (laterHandles.has(oldHandle)) {
        draft.collisions.add(
          RosterIdentityCollisionReason.OLD_HANDLE_STILL_PRESENT,
        );
      }

      if (earlierHandles.has(newHandle)) {
        draft.collisions.add(
          RosterIdentityCollisionReason.NEW_HANDLE_ALREADY_PRESENT,
        );
      }

      if (newHandlesOf.get(oldHandle)!.size > 1) {
        draft.collisions.add(RosterIdentityCollisionReason.HANDLE_SPLIT);
      }

      if (oldHandlesOf.get(newHandle)!.size > 1) {
        draft.collisions.add(RosterIdentityCollisionReason.HANDLE_MERGE);
      }
    }
  }

  /**
   * Whether a partial export skipped since the earlier one lists both of a
   * pair's names at once.
   *
   * @param pair - The pair.
   * @returns True if one does.
   */
  private listedTogether(pair: Pair): boolean {
    const from = this.keyOf(pair.from);
    const to = this.keyOf(pair.to);

    return this._skipped.some(keys => keys.has(from) && keys.has(to));
  }

  /**
   * Pairs every vanished row with every appeared row that agrees on a
   * signature and differs in the alias.
   *
   * @param kind - The kind of rename the signature describes.
   * @param vanished - Rows gone from the later export.
   * @param appeared - Rows new in the later export.
   * @param signature - What must agree, beyond the join instant and Class.
   * @returns Every matching pair.
   */
  private pairsBy(
    kind: RosterIdentityCandidateKind,
    vanished: readonly RosterIdentityRow[],
    appeared: readonly RosterIdentityRow[],
    signature: (row: RosterIdentityRow) => readonly string[],
  ): Pair[] {
    const byKey = new Map<string, RosterIdentityRow[]>();

    for (const row of appeared) {
      const key = JSON.stringify(signature(row));

      byKey.set(key, [...(byKey.get(key) ?? []), row]);
    }

    return vanished.flatMap(from =>
      (byKey.get(JSON.stringify(signature(from))) ?? []).map(to => ({
        kind,
        from,
        to,
      })),
    );
  }

  /**
   * Finds or starts the draft a pair belongs to.
   *
   * The first pair of exports to suggest a candidate is the one it cites.
   * The same candidate suggested again later, which takes a name or handle
   * changing back and then changing again, adds its links and its evidence
   * to the first rather than starting a second.
   *
   * @param pair - The pair.
   * @param earlier - The earlier export.
   * @param later - The later one.
   * @returns The draft.
   */
  private draftFor(
    pair: Pair,
    earlier: RosterIdentitySnapshot,
    later: RosterIdentitySnapshot,
  ): Draft {
    const isCharacter =
      pair.kind === RosterIdentityCandidateKind.CHARACTER_RENAME;
    const fromAliasKey = isCharacter ? this.keyOf(pair.from) : null;
    const toAliasKey = isCharacter ? this.keyOf(pair.to) : null;
    const fromHandle = isCharacter ? null : pair.from.accountHandleNormalised;
    const toHandle = isCharacter ? null : pair.to.accountHandleNormalised;
    const key = candidateKey(
      pair.kind,
      (fromAliasKey ?? fromHandle)!,
      (toAliasKey ?? toHandle)!,
    );

    let draft = this._drafts.get(key);

    if (draft === undefined) {
      draft = {
        kind: pair.kind,
        fromAliasKey,
        toAliasKey,
        fromHandleNormalised: fromHandle,
        toHandleNormalised: toHandle,
        earlierImportId: earlier.importId,
        laterImportId: later.importId,
        links: new Map(),
        held: new Map(),
        collisions: new Set(),
      };
      this._drafts.set(key, draft);
    }

    return draft;
  }

  /**
   * Adds a pair to a draft, with how its corroborating checks came out.
   *
   * A check that failed for any pair fails for the candidate, and one that
   * could not be made for any of them stays unknown.
   *
   * @param draft - The draft.
   * @param pair - The pair.
   */
  private link(draft: Draft, pair: Pair): void {
    const fromKey = this.keyOf(pair.from);

    draft.links.set(fromKey, { fromKey, toKey: this.keyOf(pair.to) });

    for (const [signal, held] of this.corroborate(pair.from, pair.to)) {
      const known = draft.held.get(signal) ?? null;

      if (held === null || known === false) {
        draft.held.set(signal, known);
      } else {
        draft.held.set(signal, held);
      }
    }
  }

  /**
   * Makes the corroborating checks on one pair.
   *
   * @param from - The earlier row.
   * @param to - The later row.
   * @returns Each check, and whether it held, or null where it could not be
   *   made.
   */
  private corroborate(
    from: RosterIdentityRow,
    to: RosterIdentityRow,
  ): Array<[RosterIdentitySignal, boolean | null]> {
    const rankComparable =
      from.rankChangedAt !== null &&
      to.rankChangedAt !== null &&
      !from.rankChangedAtAmbiguous &&
      !to.rankChangedAtAmbiguous;

    return [
      [RosterIdentitySignal.LEVEL_NOT_LOWER, to.level >= from.level],
      [
        RosterIdentitySignal.CONTRIBUTION_NOT_LOWER,
        BigInt(to.contributionTotal) >= BigInt(from.contributionTotal),
      ],
      [
        RosterIdentitySignal.RANK_CHANGE_NOT_EARLIER,
        rankComparable
          ? to.rankChangedAt!.getTime() >= from.rankChangedAt!.getTime()
          : null,
      ],
    ];
  }

  /**
   * Grades how much of the corroborating evidence held.
   *
   * No failed check is high, one is medium and two or more are low. An
   * account rename resting on a single Character is never higher than medium:
   * the plan asks for several alts before an account rename is believed, and
   * one is what the corpus has.
   *
   * @param kind - Whether the name or the handle changed.
   * @param signals - How each check came out.
   * @param links - How many alias pairs it cites.
   * @returns The confidence.
   */
  private confidence(
    kind: RosterIdentityCandidateKind,
    signals: ReadonlyArray<{ readonly held: boolean | null }>,
    links: number,
  ): RosterIdentityConfidence {
    const failed = signals.filter(({ held }) => held === false).length;

    if (failed >= 2) {
      return RosterIdentityConfidence.LOW;
    }

    if (
      failed === 1 ||
      (kind === RosterIdentityCandidateKind.ACCOUNT_RENAME && links < 2)
    ) {
      return RosterIdentityConfidence.MEDIUM;
    }

    return RosterIdentityConfidence.HIGH;
  }

  /**
   * Whether a row can take part in a rename at all.
   *
   * Only with a join instant that is present and was not one of two. The plan
   * excludes an ambiguous one from matching until somebody resolves it, rather
   * than guessing which of the two instants it was.
   *
   * @param row - The row.
   * @returns True if it can be matched.
   */
  private isMatchable(row: RosterIdentityRow): boolean {
    return row.joinedAt !== null && !row.joinedAtAmbiguous;
  }

  /**
   * The part of a signature both kinds of rename share.
   *
   * @param row - A matchable row.
   * @returns The join instant and the exact Class text.
   */
  private joinAndClass(row: RosterIdentityRow): string {
    return JSON.stringify([row.joinedAt!.getTime(), row.className]);
  }

  /**
   * The alias key of a row.
   *
   * @param row - The row.
   * @returns Its key.
   */
  private keyOf(row: RosterIdentityRow): string {
    return rosterAliasKey(
      row.characterNameNormalised,
      row.accountHandleNormalised,
    );
  }
}
