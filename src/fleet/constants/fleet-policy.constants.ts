/**
 * The published access and retention policy, as code.
 *
 * These seven figures are stated in the product requirements and repeated in
 * the privacy policy a user reads. They fall into two kinds, and the
 * difference is deliberate rather than an oversight.
 *
 * **Fixed.** The four-hour history window, the seven-day transcript window,
 * the three custom channels per level and the ninety-day proposal window are
 * constants with no environment variable behind them. Nothing in R20, R22 or
 * FC-014 describes them as configurable, and a value an operator can quietly
 * raise is a policy statement that can stop being true without anybody
 * publishing a correction. Changing one is a code change, which is exactly the
 * thing that forces the policy page to be updated in the same release.
 *
 * **Configurable, with a floor.** R22 calls the 45-day chat retention
 * "environment configurable" and R27 says import-source retention "starts at"
 * 180 days, so both read from the environment. `ConfigCheckService` refuses a
 * chat retention shorter than the transcript window at startup, because a
 * transcript covering seven days of history that is only retained for three is
 * an export that silently returns less than it offers.
 *
 * Decided with Steve on 17 September 2026; recorded in ADR-0011.
 */

/**
 * How far back ordinary chat history may be read, in hours (R22).
 *
 * A server-side floor of `now - 4 hours` applies to every path — cursor,
 * search, reply preview, reconnect and direct message alike — not just the
 * default page.
 */
export const CHAT_MEMBER_HISTORY_HOURS = 4;

/**
 * How far back an authorised scope admin may export a transcript, in days (R22).
 */
export const CHAT_TRANSCRIPT_HISTORY_DAYS = 7;

/**
 * How many custom channels one scope may have, at each level (R20).
 *
 * Deliberately not resolved through `LimitService`. That service answers "what
 * may this *user* have", and this is a ceiling on a *scope*: resolving it
 * against whoever happens to be acting would let an admin holding an exemption
 * create a fourth channel that every other admin then sees as one over the
 * limit. Plan section 10 names that accident directly.
 */
export const FLEET_CUSTOM_CHANNEL_LIMIT = 3;

/**
 * The published retention period for ordinary chat messages, in days (R22).
 *
 * The default for `CHAT_RETENTION_DAYS`, and the figure the privacy policy
 * states. An environment that sets something else is honoured; an environment
 * that sets something shorter than {@link CHAT_TRANSCRIPT_HISTORY_DAYS} is
 * refused at startup.
 */
export const PUBLISHED_CHAT_RETENTION_DAYS = 45;

/**
 * The published retention period for sanitised import sources, in days (R27).
 *
 * The default for `IMPORT_SOURCE_RETENTION_DAYS`. This window governs the
 * stored file only: the immutable roster observations drawn from it are kept
 * for as long as Fleet history requires, and ADR-0001 records why those are not
 * the same thing.
 */
export const PUBLISHED_IMPORT_SOURCE_RETENTION_DAYS = 180;

/**
 * How many live Fleet Communities one account may own (R03, ADR-0022).
 *
 * R03 describes "one persistent umbrella" and the schema permits any number.
 * Ten was chosen over both: a player may keep a PC Community and a console one
 * apart, or an Armada's umbrella away from a personal one, while one account
 * still cannot mint unlimited public directory entries.
 *
 * Fixed in code rather than configurable, for the reason the file's other
 * fixed figures are: it is a published limit a user is told about when they
 * reach it, so raising it should be a release rather than an environment
 * variable.
 *
 * The number also appears in `1792800000000-LimitFleetCommunitiesPerOwner`,
 * because a count cannot be enforced without a race anywhere but in the
 * database. That is a duplication, and this file's spec reads the migration to
 * hold the two together.
 */
export const MAX_FLEET_COMMUNITIES_PER_OWNER = 10;

/**
 * How long a Character Fleet proposal stays answerable, in days (FC-014).
 *
 * Long enough that somebody who plays at weekends and reads their inbox
 * monthly still gets to answer, short enough that a question about a roster
 * taken half a year ago is not still sitting there implying it is current.
 *
 * Fixed rather than configurable, and the reason is the same as the other
 * fixed figures here: the window is stated to the person being asked, on the
 * proposal itself, so shortening it is a statement that stops being true
 * unless somebody publishes the correction.
 *
 * The date is written onto each proposal when it is raised and read back
 * thereafter, so changing this figure does not move the deadline on a
 * proposal somebody has already been told about.
 */
export const CHARACTER_FLEET_PROPOSAL_EXPIRY_DAYS = 90;
