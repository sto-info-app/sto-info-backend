/**
 * The inactivity windows a user is allowed to choose between, in minutes.
 *
 * The same list is enforced three ways: the settings DTO validates against it,
 * the `CHK_user_profile_session_timeout` constraint added by
 * `AddSessionTimeoutToUserProfile` rejects anything else at the database, and
 * the client offers the matching labels. Changing it means changing all three.
 */
export const SESSION_TIMEOUT_OPTIONS_MINUTES = [60, 240, 480] as const;

/** The shortest inactivity window a user may choose. */
export const MIN_SESSION_TIMEOUT_MINUTES = SESSION_TIMEOUT_OPTIONS_MINUTES[0];

/** The longest inactivity window a user may choose. */
export const MAX_SESSION_TIMEOUT_MINUTES =
  SESSION_TIMEOUT_OPTIONS_MINUTES[SESSION_TIMEOUT_OPTIONS_MINUTES.length - 1];

/** Used for accounts that have never chosen, and when nothing else resolves. */
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 240;

/** One of the inactivity windows a user is allowed to choose. */
export type SessionTimeoutMinutes =
  (typeof SESSION_TIMEOUT_OPTIONS_MINUTES)[number];

/**
 * Reports whether a number is one of the offered inactivity windows.
 *
 * @param value - The number of minutes to check.
 * @returns True when the value is one of the offered windows.
 */
export function isAllowedSessionTimeoutMinutes(
  value: number,
): value is SessionTimeoutMinutes {
  return SESSION_TIMEOUT_OPTIONS_MINUTES.some(option => option === value);
}

/**
 * Resolves the inactivity window to apply to a session.
 *
 * A profile that has never chosen falls back to the deployment's configured
 * refresh window where that happens to be one of the offered options, and to
 * the default otherwise. A stored value outside the offered options is treated
 * the same way as no choice at all, so a row that predates or sidesteps the
 * database constraint cannot widen a session beyond what is on offer.
 *
 * @param selected - The window stored on the user's profile, if any.
 * @param configuredDefaultSeconds - The deployment's refresh window, in seconds.
 * @returns The inactivity window to apply, in minutes.
 */
export function resolveSessionTimeoutMinutes(
  selected: number | null | undefined,
  configuredDefaultSeconds = Number(process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN),
): SessionTimeoutMinutes {
  const configuredDefault = configuredDefaultSeconds / 60;
  const fallback = isAllowedSessionTimeoutMinutes(configuredDefault)
    ? configuredDefault
    : DEFAULT_SESSION_TIMEOUT_MINUTES;

  const candidate = selected ?? fallback;
  return isAllowedSessionTimeoutMinutes(candidate) ? candidate : fallback;
}
