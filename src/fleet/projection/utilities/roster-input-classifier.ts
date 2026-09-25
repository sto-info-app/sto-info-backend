import { RosterProjectionInputOutcome } from '../enums/roster-projection-input-outcome.enum';
import { compareText } from './compare-text.utility';

/** What the classifier needs to know of one import in force or held. */
export interface RosterInputCandidate {
  /** The import. */
  readonly id: string;
  /** The instant its export claims. */
  readonly exportedAt: Date;
  /** When it was uploaded: the first version of a moment stands. */
  readonly uploadedAt: Date;
  /** The hash of its sanitised contents, to tell a copy from a rival. */
  readonly sanitisedSha256: string;
  /** Whether its placement is in force; otherwise it is held. */
  readonly inForce: boolean;
  /** Whether an investigator has excluded it. */
  readonly excluded: boolean;
  /** Whether an investigator has marked it partial. */
  readonly partial: boolean;
  /** How many of its rows an investigator has excluded. */
  readonly excludedRows: number;
  /** The conflict group it is in, if any. */
  readonly conflictGroupId: string | null;
}

/** One import, and what a projection revision makes of it. */
export interface ClassifiedRosterInput extends RosterInputCandidate {
  /** Whether it is read, and why not when it is not. */
  readonly outcome: RosterProjectionInputOutcome;
}

/**
 * Decides which import of each moment a projection reads (FC-019).
 *
 * Pure. Imports are taken a moment at a time — every import claiming one
 * export instant together — and at most one of each is effective:
 *
 * - **An excluded import is never read**, whatever else is true of it.
 * - **A selection decides.** Where an investigator has selected an export
 *   of the moment's conflict group, that export is read if it is in force
 *   and not excluded. Any other in force with the same contents is
 *   `SAME_AS_EFFECTIVE`; the rest were not selected. A selected export
 *   excluded afterwards leaves the moment with none, until somebody selects
 *   again — Steve's decision of 25 September 2026 that a selection can be
 *   changed, never that it changes itself.
 * - **Otherwise the first version stands.** The earliest upload in force
 *   and not excluded is read, as FC-017 already keeps it in force; a later
 *   copy of it is `SAME_AS_EFFECTIVE`, and anything held is waiting for a
 *   selection. An import in force that says something different from the
 *   one read cannot arise, since FC-017 holds any such at upload; if one
 *   ever did, it is reported as waiting rather than silently dropped.
 *
 * @param candidates - Every import of the Fleet in force or held, with an
 *   export instant, in any order.
 * @param selections - Each conflict group's selected import, or null.
 * @returns Every candidate with its outcome, in export order, then upload
 *   order.
 */
export function classifyRosterInputs(
  candidates: readonly RosterInputCandidate[],
  selections: ReadonlyMap<string, string | null>,
): ClassifiedRosterInput[] {
  const ordered = [...candidates].sort(
    (a, b) =>
      a.exportedAt.getTime() - b.exportedAt.getTime() ||
      a.uploadedAt.getTime() - b.uploadedAt.getTime() ||
      compareText(a.id, b.id),
  );
  const moments = new Map<number, RosterInputCandidate[]>();

  for (const candidate of ordered) {
    const at = candidate.exportedAt.getTime();

    moments.set(at, [...(moments.get(at) ?? []), candidate]);
  }

  return [...moments.values()].flatMap(classifyMoment(selections));
}

/**
 * Classifies every import of one moment.
 *
 * @param selections - Each conflict group's selected import, or null.
 * @returns A function from the moment's imports, in upload order, to their
 *   classification.
 */
function classifyMoment(
  selections: ReadonlyMap<string, string | null>,
): (members: RosterInputCandidate[]) => ClassifiedRosterInput[] {
  return members => {
    const groupId =
      members.find(member => member.conflictGroupId !== null)
        ?.conflictGroupId ?? null;
    const selectedId =
      groupId === null ? null : (selections.get(groupId) ?? null);
    const eligible = (member: RosterInputCandidate): boolean =>
      member.inForce && !member.excluded;

    const effective =
      selectedId === null
        ? (members.find(eligible) ?? null)
        : (members.find(
            member => member.id === selectedId && eligible(member),
          ) ?? null);

    return members.map(member => ({
      ...member,
      outcome: outcomeOf(member, effective, selectedId),
    }));
  };
}

/**
 * The outcome of one import of a moment.
 *
 * @param member - The import.
 * @param effective - The import of the moment that is read, if any.
 * @param selectedId - The moment's selected import, if one was selected.
 * @returns Its outcome.
 */
function outcomeOf(
  member: RosterInputCandidate,
  effective: RosterInputCandidate | null,
  selectedId: string | null,
): RosterProjectionInputOutcome {
  if (member.excluded) {
    return RosterProjectionInputOutcome.EXCLUDED;
  }

  if (member === effective) {
    return RosterProjectionInputOutcome.EFFECTIVE;
  }

  if (
    effective !== null &&
    member.inForce &&
    member.sanitisedSha256 === effective.sanitisedSha256
  ) {
    return RosterProjectionInputOutcome.SAME_AS_EFFECTIVE;
  }

  if (selectedId !== null && member.id !== selectedId) {
    return RosterProjectionInputOutcome.NOT_SELECTED;
  }

  return RosterProjectionInputOutcome.AWAITING_SELECTION;
}
