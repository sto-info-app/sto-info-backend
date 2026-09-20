/**
 * Reads the description a picture was uploaded with.
 *
 * Every Storytime slot takes its alternative text alongside the file, and
 * every one of them now writes both at publication rather than at upload:
 * the description belongs to the picture, and writing it while the work is
 * still showing the previous picture would leave the two describing
 * different images for as long as the scan takes.
 *
 * A placement written by an older version of this application, or one whose
 * detail was lost, yields an empty description rather than a missing one.
 * An empty `alt` is the correct markup for a picture with no description,
 * and refusing to publish over it would strand a perfectly good image.
 *
 * @param detail - What the placement kept for this feature.
 * @returns The description, or an empty string.
 */
export function altTextOf(detail: Record<string, unknown> | null): string {
  if (detail === null) {
    return '';
  }

  const altText = detail.altText;

  return typeof altText === 'string' ? altText : '';
}
