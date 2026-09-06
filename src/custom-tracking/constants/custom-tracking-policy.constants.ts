/**
 * The version of the Custom Tracking Content Agreement a user agrees to.
 *
 * Raising this is what makes every user agree again. The agreement reserves
 * that right for changes which materially affect what a user may store or
 * publish, so a typographical fix must not raise it and a new prohibition
 * must.
 *
 * Recorded against the acceptance alongside the date, so the record says which
 * wording was agreed rather than merely that something once was. It follows
 * the Storytime policy constant deliberately: a user who has met one versioned
 * agreement on this site should find the second one behaves the same way.
 */
export const CUSTOM_TRACKING_POLICY_VERSION = '1.0';

/**
 * The date the current agreement wording took effect.
 *
 * Held as an ISO date rather than a formatted string so the interface can
 * present it in the reader's own conventions, and so a version bump that
 * forgets to move the date is visible as a date in the past rather than as
 * plausible-looking prose.
 */
export const CUSTOM_TRACKING_POLICY_EFFECTIVE_DATE = '2026-09-04';

/**
 * The date the current agreement wording was last changed.
 *
 * Separate from the effective date because the two answer different questions:
 * when the terms started to apply, and when they were last touched. They are
 * equal at the first version and will diverge at the first amendment.
 */
export const CUSTOM_TRACKING_POLICY_UPDATED_DATE = '2026-09-04';
