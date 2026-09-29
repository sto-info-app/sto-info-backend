import { ROSTER_ALLOWED_COLUMNS } from '../imports/constants/roster-csv.constants';

/** What an erased Character is called wherever a roster shows it. */
export const ERASED_MEMBER_NAME = 'Erased member';

/** Where each part of an erased row sits in a sanitised roster row. */
export const ERASED_COLUMNS = {
  characterName: ROSTER_ALLOWED_COLUMNS.indexOf('Character Name'),
  accountHandle: ROSTER_ALLOWED_COLUMNS.indexOf('Account Handle'),
  publicComment: ROSTER_ALLOWED_COLUMNS.indexOf('Public Comment'),
} as const;

/** The secret that keys every erasure hash. */
export const ROSTER_ERASURE_SECRET_KEY = 'rosterErasureKey';

/** Where each erasure's marker is kept outside the database. */
export const ERASURE_LEDGER_PREFIX = 'erasure-ledger';

/** How long an erasure's reason must be. */
export const ROSTER_ERASURE_REASON = { min: 10, max: 500 } as const;

/**
 * The handle that stands in for an erased one: distinct for each erasure,
 * so one erased member stays one member in a Fleet's history and two stay
 * two.
 *
 * @param erasureId - The erasure.
 * @returns The pseudonym.
 */
export function pseudonymFor(erasureId: string): string {
  return `@erased-${erasureId.replace(/-/g, '').slice(0, 12)}`;
}
