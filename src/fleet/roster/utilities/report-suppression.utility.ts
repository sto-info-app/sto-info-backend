/**
 * The fewest members a figure shown to an aggregate audience may count
 * (FC-020, Steve's decision of 25 September 2026).
 */
export const REPORT_MINIMUM_COHORT = 5;

/**
 * Hides the small counts in a group that together make up one whole.
 *
 * For a report shown to the Community or to anyone, which sees aggregates
 * only. Any count from 1 to 4 is hidden. Where that hides exactly one count
 * in the group, the smallest count still shown is hidden too, so the one
 * hidden cannot be got back by subtracting the rest from a total shown
 * elsewhere (Steve's decision of 25 September 2026). A zero is never hidden
 * for its own sake: it counts nobody.
 *
 * @param counts - The group, in any order.
 * @param minimum - The fewest members a shown count may count.
 * @returns The same counts in the same order, null where hidden.
 */
export function suppressGroup(
  counts: readonly number[],
  minimum: number = REPORT_MINIMUM_COHORT,
): Array<number | null> {
  const hidden = counts.map(count => count > 0 && count < minimum);

  if (hidden.filter(Boolean).length === 1 && counts.length > 1) {
    let smallest = -1;

    for (const [index, count] of counts.entries()) {
      if (!hidden[index] && (smallest === -1 || count < counts[smallest])) {
        smallest = index;
      }
    }

    hidden[smallest] = true;
  }

  return counts.map((count, index) => (hidden[index] ? null : count));
}

/**
 * Hides a single count standing on its own.
 *
 * @param count - The count.
 * @param minimum - The fewest members a shown count may count.
 * @returns The count, or null when it is from 1 to 4.
 */
export function suppressCount(
  count: number,
  minimum: number = REPORT_MINIMUM_COHORT,
): number | null {
  return count > 0 && count < minimum ? null : count;
}
