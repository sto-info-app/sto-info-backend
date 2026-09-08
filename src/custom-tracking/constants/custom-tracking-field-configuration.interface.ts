import { CustomTrackingDateFormat } from '../enums/custom-tracking-date-format.enum';
import { CustomTrackingDurationFormat } from '../enums/custom-tracking-duration-format.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';
import { CustomTrackingMonthYearFormat } from '../enums/custom-tracking-month-year-format.enum';
import { CustomTrackingTimeFormat } from '../enums/custom-tracking-time-format.enum';

/**
 * A Field type with no configuration of its own.
 *
 * Present as a named type rather than as `Record<string, never>` repeated in
 * six places, so the several types that genuinely have nothing to configure
 * say so once. They still carry the properties every Field has — whether it is
 * required, how it behaves when empty — because those live on the Field row
 * rather than in this fragment.
 */
export type CustomTrackingEmptyConfiguration = Record<string, never>;

/** How a single-line text Field constrains what may be typed into it. */
export interface CustomTrackingTextConfiguration {
  /** The fewest characters accepted, or null for no floor. */
  readonly minLength: number | null;
  /** The most characters accepted, or null for the type's own ceiling. */
  readonly maxLength: number | null;
  /**
   * A pattern the value must match, or null.
   *
   * Held as a source string and compiled with a time bound wherever it is
   * applied. A user writing their own pattern can write a catastrophically
   * backtracking one without meaning to, and this one is run against every
   * value they save.
   */
  readonly pattern: string | null;
  /** Grey text shown in the empty editor, or null. */
  readonly placeholder: string | null;
}

/** How a Markdown Field constrains what may be written into it. */
export interface CustomTrackingMarkdownConfiguration {
  /** The most characters of source accepted, or null for the type's ceiling. */
  readonly maxLength: number | null;
  /** Grey text shown in the empty editor, or null. */
  readonly placeholder: string | null;
}

/** How a whole-number Field constrains its values. */
export interface CustomTrackingIntegerConfiguration {
  /** The smallest value accepted, or null. */
  readonly minimum: number | null;
  /** The largest value accepted, or null. */
  readonly maximum: number | null;
  /** The interval values must fall on, counted from the minimum, or null. */
  readonly step: number | null;
}

/**
 * How a decimal or percentage Field constrains its values.
 *
 * Bounds are carried as strings for the same reason the values are: a decimal
 * that passes through a JSON number has already been rounded by the time
 * anything can check it, and a bound that has been rounded is not a bound.
 */
export interface CustomTrackingDecimalConfiguration {
  /** The smallest value accepted, as an exact decimal string, or null. */
  readonly minimum: string | null;
  /** The largest value accepted, as an exact decimal string, or null. */
  readonly maximum: string | null;
  /** Decimal places kept. */
  readonly precision: number;
  /** The interval values must fall on, as an exact decimal string, or null. */
  readonly step: string | null;
}

/**
 * How a slider Field is bounded.
 *
 * Unlike the other numeric types every bound is required, because a slider
 * with no ends is not a slider.
 */
export interface CustomTrackingRangeConfiguration {
  /** The value at the left-hand end. */
  readonly minimum: number;
  /** The value at the right-hand end. */
  readonly maximum: number;
  /** The interval the handle moves in. */
  readonly step: number;
}

/** How a rating Field is scaled. */
export interface CustomTrackingRatingConfiguration {
  /** The top of the scale: three, five or ten. */
  readonly maximum: number;
}

/**
 * How a progress Field is bounded and presented.
 *
 * The presentation switches change only what is drawn. Both the current figure
 * and the total are stored on every value, so turning the percentage off and
 * on again re-reads what was saved rather than recomputing it from a total
 * that may since have changed.
 */
export interface CustomTrackingProgressConfiguration {
  /** The smallest current figure accepted, or null. */
  readonly minimum: number | null;
  /** The largest total accepted, or null. */
  readonly maximum: number | null;
  /** Whether the figures are also shown as a percentage. */
  readonly showPercentage: boolean;
  /** Whether the figures are also drawn as a bar. */
  readonly showProgressBar: boolean;
}

/** How a date Field is bounded and written out. */
export interface CustomTrackingDateConfiguration {
  /** The earliest date accepted, as `YYYY-MM-DD`, or null. */
  readonly minimumDate: string | null;
  /** The latest date accepted, as `YYYY-MM-DD`, or null. */
  readonly maximumDate: string | null;
  /** How the date is written out. */
  readonly dateFormat: CustomTrackingDateFormat;
}

/**
 * How a time Field is presented, and where it starts from.
 *
 * The default timezone seeds the editor. A user may override it for an
 * individual Account or Character, because the same Field may reasonably
 * describe a fleet event two players attend from different countries.
 */
export interface CustomTrackingTimeConfiguration {
  /** The IANA timezone the editor offers first. */
  readonly defaultTimezone: string;
  /** How the time is written out. */
  readonly timeFormat: CustomTrackingTimeFormat;
}

/** How a date-and-time Field is presented, and where it starts from. */
export interface CustomTrackingDateTimeConfiguration {
  /** The IANA timezone the editor offers first. */
  readonly defaultTimezone: string;
  /** How the date part is written out. */
  readonly dateFormat: CustomTrackingDateFormat;
  /** How the time part is written out. */
  readonly timeFormat: CustomTrackingTimeFormat;
}

/** How a month-and-year Field is written out. */
export interface CustomTrackingMonthYearConfiguration {
  /** How the month and year are written out. */
  readonly monthYearFormat: CustomTrackingMonthYearFormat;
}

/** How a year Field is bounded. */
export interface CustomTrackingYearConfiguration {
  /** The earliest year accepted, or null. */
  readonly minimumYear: number | null;
  /** The latest year accepted, or null. */
  readonly maximumYear: number | null;
}

/**
 * How a duration Field is entered and written out.
 *
 * The components decide which boxes the editor offers. A duration measured in
 * days and hours should not ask for seconds, and one measured in minutes
 * should not ask for days.
 */
export interface CustomTrackingDurationConfiguration {
  /** How the duration is written out. */
  readonly durationFormat: CustomTrackingDurationFormat;
  /** Whether days are entered. */
  readonly includeDays: boolean;
  /** Whether hours are entered. */
  readonly includeHours: boolean;
  /** Whether minutes are entered. */
  readonly includeMinutes: boolean;
  /** Whether seconds are entered. */
  readonly includeSeconds: boolean;
}

/** How a date-range Field is bounded and written out. */
export interface CustomTrackingDateRangeConfiguration {
  /** The earliest start date accepted, as `YYYY-MM-DD`, or null. */
  readonly minimumDate: string | null;
  /** The latest end date accepted, as `YYYY-MM-DD`, or null. */
  readonly maximumDate: string | null;
  /** How both endpoints are written out. */
  readonly dateFormat: CustomTrackingDateFormat;
}

/** How a date-and-time-range Field is presented, and where it starts from. */
export interface CustomTrackingDateTimeRangeConfiguration {
  /** The IANA timezone the editor offers first. */
  readonly defaultTimezone: string;
  /** How the date part of both endpoints is written out. */
  readonly dateFormat: CustomTrackingDateFormat;
  /** How the time part of both endpoints is written out. */
  readonly timeFormat: CustomTrackingTimeFormat;
}

/** How many options a multiple-answer Field requires and permits. */
export interface CustomTrackingMultipleChoiceConfiguration {
  /** The fewest options that must be chosen, or null. */
  readonly minimumSelections: number | null;
  /** The most options that may be chosen, or null. */
  readonly maximumSelections: number | null;
}

/** Which shape an image Field's pictures are cropped to. */
export interface CustomTrackingImageConfiguration {
  /** The crop shape, fixed for every picture answering this Field. */
  readonly shape: CustomTrackingImageShape;
}

/**
 * The configuration each Field type carries.
 *
 * Keyed by type so a lookup is checked rather than cast. The fragment is held
 * in a JSONB column, which PostgreSQL will accept any shape into, so this map
 * and the validators built from it are the only thing standing between a
 * definition and a configuration nothing can render.
 */
export interface CustomTrackingFieldConfigurationMap {
  [CustomTrackingFieldType.TEXT_SINGLE_LINE]: CustomTrackingTextConfiguration;
  [CustomTrackingFieldType.MARKDOWN]: CustomTrackingMarkdownConfiguration;
  [CustomTrackingFieldType.INTEGER]: CustomTrackingIntegerConfiguration;
  [CustomTrackingFieldType.DECIMAL]: CustomTrackingDecimalConfiguration;
  [CustomTrackingFieldType.PERCENTAGE]: CustomTrackingDecimalConfiguration;
  [CustomTrackingFieldType.RANGE]: CustomTrackingRangeConfiguration;
  [CustomTrackingFieldType.RATING]: CustomTrackingRatingConfiguration;
  [CustomTrackingFieldType.PROGRESS]: CustomTrackingProgressConfiguration;
  [CustomTrackingFieldType.DATE]: CustomTrackingDateConfiguration;
  [CustomTrackingFieldType.TIME]: CustomTrackingTimeConfiguration;
  [CustomTrackingFieldType.DATE_TIME]: CustomTrackingDateTimeConfiguration;
  [CustomTrackingFieldType.MONTH_YEAR]: CustomTrackingMonthYearConfiguration;
  [CustomTrackingFieldType.YEAR]: CustomTrackingYearConfiguration;
  [CustomTrackingFieldType.DURATION]: CustomTrackingDurationConfiguration;
  [CustomTrackingFieldType.DATE_RANGE]: CustomTrackingDateRangeConfiguration;
  [CustomTrackingFieldType.DATE_TIME_RANGE]: CustomTrackingDateTimeRangeConfiguration;
  [CustomTrackingFieldType.TOGGLE]: CustomTrackingEmptyConfiguration;
  [CustomTrackingFieldType.CHECKBOX]: CustomTrackingEmptyConfiguration;
  [CustomTrackingFieldType.RADIO]: CustomTrackingEmptyConfiguration;
  [CustomTrackingFieldType.DROPDOWN]: CustomTrackingEmptyConfiguration;
  [CustomTrackingFieldType.CHECKBOX_LIST]: CustomTrackingMultipleChoiceConfiguration;
  [CustomTrackingFieldType.MULTI_SELECT]: CustomTrackingMultipleChoiceConfiguration;
  [CustomTrackingFieldType.YES_NO_UNKNOWN]: CustomTrackingEmptyConfiguration;
  [CustomTrackingFieldType.COLOUR]: CustomTrackingEmptyConfiguration;
  [CustomTrackingFieldType.TAGS]: CustomTrackingMultipleChoiceConfiguration;
  [CustomTrackingFieldType.IMAGE]: CustomTrackingImageConfiguration;
  [CustomTrackingFieldType.YOUTUBE]: CustomTrackingEmptyConfiguration;
}

/**
 * Any Field's configuration fragment.
 */
export type CustomTrackingFieldConfiguration =
  CustomTrackingFieldConfigurationMap[CustomTrackingFieldType];
