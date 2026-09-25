/**
 * The fewest members a figure shown to an aggregate audience may count
 * (FC-020, Steve's decision of 25 September 2026).
 */
export const REPORT_MINIMUM_COHORT = 5;

/**
 * Hides the small counts in a group that together make up one whole.
 *
 * For a report shown to the Community or to anyone, which sees aggregates
 * only. Any count from 1 to 4 is hidden. Then, so that no hidden count can
 * be got back by subtracting the rest from a total shown elsewhere, the
 * smallest counts still shown are hidden too, one by one, until the hidden
 * counts together count at least the minimum, or every count is hidden
 * (Steve's decisions of 25 September 2026). A zero is never hidden for its
 * own sake, since it counts nobody, but is hidden first when more must be:
 * it gives the least away.
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
  let hiddenTotal = counts.reduce(
    (total, count, index) => (hidden[index] ? total + count : total),
    0,
  );

  if (hidden.includes(true)) {
    const shown = counts
      .map((count, index) => ({ count, index }))
      .filter(({ index }) => !hidden[index])
      .sort((a, b) => a.count - b.count || a.index - b.index);

    for (const { count, index } of shown) {
      if (hiddenTotal >= minimum) {
        break;
      }

      hidden[index] = true;
      hiddenTotal += count;
    }
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
