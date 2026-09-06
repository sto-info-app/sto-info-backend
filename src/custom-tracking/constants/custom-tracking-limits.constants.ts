/**
 * The structural ceilings a user's definitions are held to.
 *
 * Fixed rather than configurable, unlike the Storytime limits. Those cap how
 * much content one creator may publish and are worth granting an exemption
 * against; these decide how large a hierarchy the value editor and the detail
 * pages have to render in one go. Raising one for a single user would not
 * unlock anything for them so much as it would produce a page nobody can use
 * on a phone, so the number is the same for everybody and changing it is a
 * deployment.
 *
 * Every one of these is enforced by the backend, which is authoritative. The
 * frontend applies the same numbers so a user is warned before they lose work,
 * never so the server can trust that they were.
 */
export const CUSTOM_TRACKING_LIMITS = {
  /** Active Sections one user may have in one target scope. */
  MAX_SECTIONS_PER_SCOPE: 10,
  /** Active Tabs one Section may contain. */
  MAX_TABS_PER_SECTION: 10,
  /** Active Fields one Tab may contain. */
  MAX_FIELDS_PER_TAB: 25,
  /** Active Fields one user may have in one target scope. */
  MAX_FIELDS_PER_SCOPE: 200,
  /**
   * Active and soft-deleted Fields together, in one target scope.
   *
   * Deleted definitions are kept for the retention period, so a user who
   * repeatedly builds and deletes could otherwise accumulate rows without
   * limit while never appearing to exceed the active ceiling. This is the
   * number that actually bounds the storage.
   */
  MAX_FIELDS_PER_SCOPE_INCLUDING_DELETED: 400,
  /** Characters in a Section, Tab, Field or option label. */
  MAX_LABEL_LENGTH: 100,
  /** Characters in a description or help text. */
  MAX_DESCRIPTION_LENGTH: 500,
  /** Characters in a single-line text value. */
  MAX_TEXT_VALUE_LENGTH: 500,
  /** Characters of Markdown source in one value. */
  MAX_MARKDOWN_VALUE_LENGTH: 10_000,
  /** Predefined options one choice Field may offer. */
  MAX_OPTIONS_PER_FIELD: 50,
  /** Tags one value may carry. */
  MAX_TAGS_PER_VALUE: 50,
  /** Characters in one tag. */
  MAX_TAG_LENGTH: 100,
  /** Characters of alternative text for one image. */
  MAX_IMAGE_ALT_LENGTH: 300,
  /** Characters in a placeholder shown where a value is empty. */
  MAX_PLACEHOLDER_LENGTH: 100,
} as const;

/**
 * The rating maxima a user may choose between.
 *
 * Three, five or ten, and nothing else. An arbitrary maximum would have to be
 * rendered as an arbitrary number of stars, which stops being readable long
 * before it stops being expressible.
 */
export const CUSTOM_TRACKING_RATING_MAXIMA: readonly number[] = [3, 5, 10];

/**
 * How many days deleted definitions, values and their audit records are kept.
 *
 * Matches the retention window the published privacy material already states
 * for audit and closed-account data, so the feature does not introduce a
 * second, undocumented period a user would have to discover.
 */
export const CUSTOM_TRACKING_RETENTION_DAYS = 180;

/**
 * The largest number of decimal places a decimal or percentage Field may keep.
 *
 * Bounded because the precision decides the database column's scale, and an
 * unbounded one would let a definition demand a column no value could ever
 * usefully fill.
 */
export const CUSTOM_TRACKING_MAX_DECIMAL_PRECISION = 6;

/**
 * The largest magnitude any numeric value may reach.
 *
 * Chosen to sit inside the exact-integer range of a double, so a value that
 * survives validation here can also be transported through JSON without
 * quietly changing. Decimals are carried as strings for the same reason, but
 * the bound applies to both so the two kinds of number behave alike.
 */
export const CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE = 1_000_000_000;

/**
 * The years a year, date or date-time value may fall within.
 *
 * Wide enough for any date a Star Trek Online player might record, including
 * the stardates of the fiction, and narrow enough that a mistyped or
 * generated year is refused rather than stored.
 */
export const CUSTOM_TRACKING_MIN_YEAR = 1;
export const CUSTOM_TRACKING_MAX_YEAR = 9999;

/**
 * The longest pattern a single-line text Field may be constrained by.
 *
 * A user writing their own regular expression can write a catastrophically
 * backtracking one without meaning to, and it is run against every value they
 * save. Length is not a defence against that on its own — the pattern is
 * compiled with a time bound wherever it is applied — but it keeps a
 * definition from carrying an expression nobody could read to check.
 */
export const CUSTOM_TRACKING_MAX_PATTERN_LENGTH = 200;

/**
 * The bounds the builder needs in order to offer a type's settings at all.
 *
 * Served alongside the structural limits for the same reason those are: the
 * builder has to offer three, five or ten stars and refuse a year outside the
 * accepted span, and a second copy of either in the frontend would be a second
 * statement that could disagree with this one.
 *
 * Grouped rather than folded into `CUSTOM_TRACKING_LIMITS` because these bound
 * one Field type's settings each, where those bound the hierarchy as a whole.
 */
export const CUSTOM_TRACKING_FIELD_BOUNDS = {
  /** The rating maxima a rating Field may be scaled to. */
  RATING_MAXIMA: CUSTOM_TRACKING_RATING_MAXIMA,
  /** Decimal places a decimal or percentage Field may keep. */
  MAX_DECIMAL_PRECISION: CUSTOM_TRACKING_MAX_DECIMAL_PRECISION,
  /** The largest magnitude any numeric value or bound may reach. */
  MAX_NUMERIC_MAGNITUDE: CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE,
  /** The earliest year any dated value may fall in. */
  MIN_YEAR: CUSTOM_TRACKING_MIN_YEAR,
  /** The latest year any dated value may fall in. */
  MAX_YEAR: CUSTOM_TRACKING_MAX_YEAR,
  /** Characters in a text Field's pattern. */
  MAX_PATTERN_LENGTH: CUSTOM_TRACKING_MAX_PATTERN_LENGTH,
} as const;
