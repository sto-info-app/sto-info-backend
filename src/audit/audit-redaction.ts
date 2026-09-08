/**
 * The text written into the audit trail in place of redacted content.
 *
 * A marker rather than an omission, so a reader of the trail can tell that a
 * property was deliberately withheld from one that was never set.
 */
export const AUDIT_REDACTED = '[redacted]';

/**
 * Properties withheld from the audit trail, per entity class.
 */
const REDACTED_PROPERTIES = new Map<object, Set<string>>();

/**
 * Marks a property whose content must never be copied into the audit trail.
 *
 * The audit subscriber records a snapshot of every entity it sees, which is
 * what makes the trail worth having: it says what changed, not merely that
 * something did. For a few properties that is the wrong trade. Content a user
 * wrote about themselves — a note, a picture's description, a video they
 * chose — would be duplicated into a second table with a different retention
 * period and a different set of readers, and deleting the original would not
 * remove the copy.
 *
 * Marked properties are replaced with {@link AUDIT_REDACTED}. The row is still
 * written, so the trail still says who changed what and when, which is what an
 * investigation actually needs.
 *
 * @returns The property decorator.
 */
export function RedactFromAudit(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const owner = target.constructor;
    const existing = REDACTED_PROPERTIES.get(owner);

    if (existing) {
      existing.add(String(propertyKey));

      return;
    }

    REDACTED_PROPERTIES.set(owner, new Set([String(propertyKey)]));
  };
}

/**
 * Returns a copy of an entity snapshot with its marked properties withheld.
 *
 * The snapshot is copied rather than altered. The object handed in belongs to
 * the transaction in progress, and blanking a property on it would blank it
 * for whatever is about to be saved.
 *
 * @param entityClass - The entity's constructor.
 * @param snapshot - The snapshot about to be recorded, or null.
 * @returns The snapshot with redacted properties replaced, or null.
 */
export function redactForAudit(
  entityClass: object,
  snapshot: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!snapshot) {
    return null;
  }

  const redacted = REDACTED_PROPERTIES.get(entityClass);

  if (!redacted) {
    return snapshot;
  }

  const copy: Record<string, unknown> = { ...snapshot };

  for (const property of redacted) {
    if (property in copy) {
      copy[property] = AUDIT_REDACTED;
    }
  }

  return copy;
}
