/**
 * What a viewer sees where a Field has no value.
 *
 * Configured separately for the owner and for the public, because the two
 * audiences are asking different questions. An owner looking at their own
 * Character usually wants the gap visible — it is a reminder of what is still
 * unanswered — while a public visitor is better served by a page that shows
 * only what is actually there.
 *
 * None of these modes may betray that a hidden value exists. `SHOW_LABEL` and
 * `SHOW_PLACEHOLDER` are reachable only once every visibility gate has already
 * passed, so a Field a visitor is not entitled to see is absent entirely
 * rather than present and empty.
 */
export enum CustomTrackingEmptyMode {
  /** Leave the Field out of the page altogether. */
  HIDE = 'HIDE',
  /** Show the Field's label with nothing beside it. */
  SHOW_LABEL = 'SHOW_LABEL',
  /** Show the Field's label with the configured placeholder text. */
  SHOW_PLACEHOLDER = 'SHOW_PLACEHOLDER',
}
