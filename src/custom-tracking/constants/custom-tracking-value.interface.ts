import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingTriState } from '../enums/custom-tracking-tri-state.enum';

/**
 * A value whose content lives outside the JSONB fragment.
 *
 * Choice selections and pictures are held in their own tables so the database
 * itself can refuse to delete an option or orphan an image that something
 * still points at. The value row still exists for them — it is what carries
 * the Field, the target and the timestamps — but its typed fragment is empty,
 * and the related rows are the answer.
 */
export type CustomTrackingRelationalValue = Record<string, never>;

/** A single line of text. */
export interface CustomTrackingTextValue {
  readonly text: string;
}

/** A passage of Markdown, stored as its source. */
export interface CustomTrackingMarkdownValue {
  readonly markdown: string;
}

/** A whole number. */
export interface CustomTrackingIntegerValue {
  readonly integer: number;
}

/**
 * A number with a fractional part.
 *
 * Carried as a string, not a JSON number. JSON has one numeric type and it is
 * a double, so `0.1 + 0.2` is the least of it: a decimal a user typed exactly
 * would come back from storage having quietly changed, and a progress figure
 * or a percentage that no longer matches what was entered is worse than no
 * figure at all. The string is parsed with an exact decimal comparison
 * wherever it is checked, and PostgreSQL holds the same text.
 */
export interface CustomTrackingDecimalValue {
  readonly decimal: string;
}

/** A number chosen on a slider. */
export interface CustomTrackingRangeValue {
  readonly number: number;
}

/** A score against the Field's configured maximum. */
export interface CustomTrackingRatingValue {
  readonly rating: number;
}

/**
 * How far through something the user is.
 *
 * Both figures are stored. The total is not read from the Field's
 * configuration at render time, because a user who later raises the
 * configured ceiling would otherwise find every value they had already
 * recorded silently restated against the new total.
 */
export interface CustomTrackingProgressValue {
  readonly current: number;
  readonly maximum: number;
}

/** A calendar date, as `YYYY-MM-DD`. */
export interface CustomTrackingDateValue {
  readonly date: string;
}

/**
 * A time of day, as `HH:mm`, in a named timezone.
 *
 * Never converted to UTC. A time without a date is not an instant — there is
 * no way to know which day's offset applies — so converting it would be
 * guessing, and the guess would be wrong twice a year.
 */
export interface CustomTrackingTimeValue {
  readonly time: string;
  readonly timezone: string;
}

/**
 * A moment in time.
 *
 * The instant is UTC, so comparisons and ordering are unambiguous. The
 * timezone is kept beside it so the local time the user actually entered can
 * be reconstructed, which a UTC instant alone cannot do across a
 * daylight-saving change.
 */
export interface CustomTrackingDateTimeValue {
  readonly instant: string;
  readonly timezone: string;
}

/** A month within a year. */
export interface CustomTrackingMonthYearValue {
  readonly year: number;
  readonly month: number;
}

/** A four-digit year. */
export interface CustomTrackingYearValue {
  readonly year: number;
}

/**
 * A length of time, held as its components.
 *
 * Not as a total number of seconds. "Two days" and "forty-eight hours" are
 * different statements, and a user who wrote one should not be shown the
 * other.
 */
export interface CustomTrackingDurationValue {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

/** A start and end calendar date. */
export interface CustomTrackingDateRangeValue {
  readonly startDate: string;
  readonly endDate: string;
}

/** A start and end instant, with the timezone they were entered in. */
export interface CustomTrackingDateTimeRangeValue {
  readonly startInstant: string;
  readonly endInstant: string;
  readonly timezone: string;
}

/** A yes-or-no answer. */
export interface CustomTrackingBooleanValue {
  readonly boolean: boolean;
}

/** A yes, no or explicitly unknown answer. */
export interface CustomTrackingTriStateValue {
  readonly triState: CustomTrackingTriState;
}

/**
 * A colour.
 *
 * Exactly one of the two is set. A token names one of the site's own palette
 * colours and is rendered through the CSS custom property that palette
 * publishes, so a value recorded as the LCARS sunflower stays the LCARS
 * sunflower if the palette is ever adjusted. A literal is for the colour that
 * is genuinely somebody's own — a fleet's exact shade — which no shared
 * palette should be expected to carry.
 *
 * Storing the token rather than the hexadecimal it currently resolves to is
 * the whole point of the distinction. A resolved literal could not be told
 * apart from a coincidence, and a palette change would leave it behind.
 */
export interface CustomTrackingColourValue {
  readonly token: string | null;
  readonly literal: string | null;
}

/**
 * A validated YouTube video.
 *
 * Only what the site's own parser produced: an eleven-character identifier and
 * an optional offset. Never the URL a user pasted, and never anything
 * resembling markup — the embed is built by the application from the
 * identifier, so nothing a user wrote can reach the page as an attribute.
 */
export interface CustomTrackingYouTubeValue {
  readonly videoId: string;
  readonly startSeconds: number | null;
}

/**
 * The typed fragment each Field type stores.
 *
 * Keyed by type, so reading a value for a known Field yields a known shape
 * rather than something that has to be narrowed by hand at each use.
 *
 * The choice, tag and image types map to {@link CustomTrackingRelationalValue}:
 * their answers are rows in `custom_tracking_value_option` and
 * `custom_tracking_image_value`, where a foreign key can stop an option being
 * hard-deleted while a value still names it. Holding those identifiers in
 * JSONB instead would have made the reference invisible to the database, and
 * the retention job would have had nothing to consult before deleting.
 *
 * Tags are among them because a tag is drawn from a list the user defines on
 * the Field, exactly as a dropdown's answers are. What separates the two is
 * how they are shown and how many may be picked, not where they come from, so
 * they share the machinery that keeps a deleted label readable.
 */
export interface CustomTrackingValueMap {
  [CustomTrackingFieldType.TEXT_SINGLE_LINE]: CustomTrackingTextValue;
  [CustomTrackingFieldType.MARKDOWN]: CustomTrackingMarkdownValue;
  [CustomTrackingFieldType.INTEGER]: CustomTrackingIntegerValue;
  [CustomTrackingFieldType.DECIMAL]: CustomTrackingDecimalValue;
  [CustomTrackingFieldType.PERCENTAGE]: CustomTrackingDecimalValue;
  [CustomTrackingFieldType.RANGE]: CustomTrackingRangeValue;
  [CustomTrackingFieldType.RATING]: CustomTrackingRatingValue;
  [CustomTrackingFieldType.PROGRESS]: CustomTrackingProgressValue;
  [CustomTrackingFieldType.DATE]: CustomTrackingDateValue;
  [CustomTrackingFieldType.TIME]: CustomTrackingTimeValue;
  [CustomTrackingFieldType.DATE_TIME]: CustomTrackingDateTimeValue;
  [CustomTrackingFieldType.MONTH_YEAR]: CustomTrackingMonthYearValue;
  [CustomTrackingFieldType.YEAR]: CustomTrackingYearValue;
  [CustomTrackingFieldType.DURATION]: CustomTrackingDurationValue;
  [CustomTrackingFieldType.DATE_RANGE]: CustomTrackingDateRangeValue;
  [CustomTrackingFieldType.DATE_TIME_RANGE]: CustomTrackingDateTimeRangeValue;
  [CustomTrackingFieldType.TOGGLE]: CustomTrackingBooleanValue;
  [CustomTrackingFieldType.CHECKBOX]: CustomTrackingBooleanValue;
  [CustomTrackingFieldType.RADIO]: CustomTrackingRelationalValue;
  [CustomTrackingFieldType.DROPDOWN]: CustomTrackingRelationalValue;
  [CustomTrackingFieldType.CHECKBOX_LIST]: CustomTrackingRelationalValue;
  [CustomTrackingFieldType.MULTI_SELECT]: CustomTrackingRelationalValue;
  [CustomTrackingFieldType.YES_NO_UNKNOWN]: CustomTrackingTriStateValue;
  [CustomTrackingFieldType.COLOUR]: CustomTrackingColourValue;
  [CustomTrackingFieldType.TAGS]: CustomTrackingRelationalValue;
  [CustomTrackingFieldType.IMAGE]: CustomTrackingRelationalValue;
  [CustomTrackingFieldType.YOUTUBE]: CustomTrackingYouTubeValue;
}

/**
 * Any Field's typed value fragment.
 */
export type CustomTrackingValue =
  CustomTrackingValueMap[CustomTrackingFieldType];

/**
 * A Field's default, which is its value fragment or nothing at all.
 *
 * Null is not the same as an empty fragment. Null means the Field has no
 * default and a new editor opens empty; a fragment means the editor opens
 * already holding something, which the user may then clear.
 */
export type CustomTrackingDefaultValue = CustomTrackingValue | null;
