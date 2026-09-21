/**
 * What STO Info will accept as the exact in-game name of a Fleet or Armada.
 *
 * ADR-0003, accepted by Steve on 21 September 2026. The rule is deliberately
 * permissive: it validates by exclusion rather than by allow-list, because a
 * restrictive rule that turns out to be wrong stops a real Fleet registering
 * at all, and that failure is worse and less recoverable than an odd name
 * getting in.
 *
 * **The documented in-game rule is not this rule.** STO states 32 characters
 * including spaces, alphanumerics, spaces and basic punctuation, with symbols
 * such as `@`, `$`, `*` and `_` forbidden. Checked against the 1,199-file
 * roster archive, that contradicts four of the 38 Fleet names in it:
 * `Ferengi Commerce Authority Bankers` is 34 codepoints, `« Omega Armada »`
 * uses guillemets, and `boq botlhra'ghom` and `mey'elStrem boq` need the
 * apostrophe every Klingon name needs. Enforcing it would make those Fleets
 * unregisterable and would break FC-016's filename check for every file they
 * own, so it is recorded in ADR-0003 as context and not implemented.
 */

/** The shortest name accepted. A name has to be something. */
export const EXACT_GAME_NAME_MIN_CODEPOINTS = 1;

/**
 * The longest name accepted, in codepoints.
 *
 * Roughly double the longest name in the archive, so it cannot reject one
 * there is evidence for, while still bounding storage and what a directory
 * card has to lay out. Codepoints rather than UTF-16 units, so an astral
 * character counts once rather than twice.
 *
 * The column is `varchar(255)`, which is storage headroom and deliberately not
 * the rule — revisiting this bound in either direction needs no migration.
 */
export const EXACT_GAME_NAME_MAX_CODEPOINTS = 64;

/**
 * The only characters a name may not contain.
 *
 * C0 and C1 control characters, which covers the newline, carriage return,
 * tab and null that would otherwise break the roster filename contract, a log
 * line or a CSV cell. Everything else — guillemets, apostrophes, full stops,
 * hyphens, leading and trailing spaces, any script — is accepted.
 */

export const EXACT_GAME_NAME_FORBIDDEN_PATTERN = /[\u0000-\u001F\u007F-\u009F]/;
