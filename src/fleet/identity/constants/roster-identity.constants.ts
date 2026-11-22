/**
 * How many rows go into one INSERT or upsert.
 *
 * An export is capped at two thousand rows, so a Fleet's first import can
 * bring two thousand aliases with it. Batches keep every statement well
 * inside PostgreSQL's limit on bound parameters.
 */
export const ROSTER_IDENTITY_WRITE_BATCH = 500;

/**
 * The advisory lock a Fleet's identities are changed under.
 *
 * Taken by the recompute and by a reviewer's decision, so neither can
 * interleave with the other. Hashed to a lock number by PostgreSQL's
 * `hashtext`; two Fleets sharing a hash only ever wait for each other.
 *
 * @param fleetId - The Fleet.
 * @returns The text the lock number is hashed from.
 */
export function rosterIdentityLockKey(fleetId: string): string {
  return `fleet-roster-identity:${fleetId}`;
}
