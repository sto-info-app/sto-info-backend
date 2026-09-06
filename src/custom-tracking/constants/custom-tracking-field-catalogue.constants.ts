import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';

/**
 * The grouping a Field type is offered under when a user picks one.
 *
 * Presentation only. Nothing is stored against a category and no rule depends
 * on one; it exists so a list of twenty-seven types can be read as six short
 * lists instead of one long one.
 */
export enum CustomTrackingFieldCategory {
  /** Words. */
  TEXT = 'TEXT',
  /** Quantities. */
  NUMBER = 'NUMBER',
  /** Points and spans of time. */
  DATE_TIME = 'DATE_TIME',
  /** Yes-or-no answers. */
  BOOLEAN = 'BOOLEAN',
  /** Answers picked from a list. */
  CHOICE = 'CHOICE',
  /** Pictures and video. */
  MEDIA = 'MEDIA',
}

/**
 * Where a Field type's default is held.
 *
 * Three answers rather than a boolean, because the choice types keep their
 * default somewhere the others do not. A default option is recorded on the
 * option itself, so the database can refuse to delete an option that is still
 * a default and the reference cannot outlive what it points at; holding an
 * option identifier inside the Field's JSON fragment would have made that
 * reference invisible to every constraint.
 */
export enum CustomTrackingDefaultSource {
  /** The type has no default at all. */
  NONE = 'NONE',
  /** The default is the Field's own stored value fragment. */
  VALUE_FRAGMENT = 'VALUE_FRAGMENT',
  /** The default is whichever of the Field's options are marked as one. */
  OPTIONS = 'OPTIONS',
}

/**
 * What the application knows about a Field type without looking at any Field.
 */
export interface CustomTrackingFieldTypeSpec {
  /** What the type is called where a user picks one. */
  readonly label: string;
  /** A sentence explaining what the type is for. */
  readonly description: string;
  /** The list the type is offered under. */
  readonly category: CustomTrackingFieldCategory;
  /**
   * Whether the type draws its answers from a list the user defines.
   *
   * This is what decides whether option endpoints accept a Field at all, so it
   * is read rather than inferred from the type in each place that cares.
   */
  readonly usesOptions: boolean;
  /** Whether a value may reference more than one option. */
  readonly allowsMultipleOptions: boolean;
  /**
   * Where the type's default comes from, if it has one at all.
   *
   * A default seeds an editor that has no value yet and never overwrites one
   * that does.
   */
  readonly defaultSource: CustomTrackingDefaultSource;
  /**
   * Whether values of this type name an IANA timezone.
   *
   * Only the types carrying a time do. A calendar date has no timezone, and
   * giving it one would invite exactly the conversion that turns the fourth of
   * September into the third.
   */
  readonly usesTimezone: boolean;
  /**
   * Whether a Field of this type may demand an answer.
   *
   * A switch and a tick box are drawn as a control that is always showing one
   * of its two positions, so asking their owner to insist on an answer offers
   * a rule nobody looking at the record could tell was being kept. The value
   * itself is still three-state underneath — unanswered is not the same as
   * answered no — and a Field of this type is simply never made to require
   * one.
   */
  readonly allowsRequired: boolean;
}

/**
 * Everything the application knows about each Field type.
 *
 * One table, read by the definition validator, the value validator, the
 * Swagger contract and the interface that offers the types, so a type's
 * capabilities are stated once. The alternative — a switch in each of those
 * places — is how a type comes to accept options in one layer and refuse them
 * in the next.
 *
 * The labels here are the site's own wording and may be changed freely. The
 * keys may not: they are {@link CustomTrackingFieldType} values, which are
 * stored.
 */
export const CUSTOM_TRACKING_FIELD_CATALOGUE = {
  TEXT_SINGLE_LINE: {
    label: 'Single-line text',
    description: 'A short line of text, such as a name or a note to yourself.',
    category: CustomTrackingFieldCategory.TEXT,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  MARKDOWN: {
    label: 'Multi-line text',
    description:
      'A longer passage, written in Markdown and shown the same way Storytime shows it.',
    category: CustomTrackingFieldCategory.TEXT,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  INTEGER: {
    label: 'Whole number',
    description: 'A number with no fractional part, such as a count.',
    category: CustomTrackingFieldCategory.NUMBER,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  DECIMAL: {
    label: 'Decimal number',
    description: 'A number with a fractional part, kept exactly as entered.',
    category: CustomTrackingFieldCategory.NUMBER,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  PERCENTAGE: {
    label: 'Percentage',
    description: 'A proportion out of one hundred.',
    category: CustomTrackingFieldCategory.NUMBER,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  RANGE: {
    label: 'Slider',
    description: 'A number chosen on a slider between bounds you set.',
    category: CustomTrackingFieldCategory.NUMBER,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  RATING: {
    label: 'Rating',
    description: 'A score out of three, five or ten.',
    category: CustomTrackingFieldCategory.NUMBER,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  PROGRESS: {
    label: 'Progress',
    description: 'How far through something you are, as a figure and a total.',
    category: CustomTrackingFieldCategory.NUMBER,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  DATE: {
    label: 'Date',
    description: 'A calendar date, with no time of day.',
    category: CustomTrackingFieldCategory.DATE_TIME,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  TIME: {
    label: 'Time',
    description: 'A time of day in a named timezone, with no date.',
    category: CustomTrackingFieldCategory.DATE_TIME,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: true,
    allowsRequired: true,
  },
  DATE_TIME: {
    label: 'Date and time',
    description: 'A moment in time, kept in UTC with the timezone you entered.',
    category: CustomTrackingFieldCategory.DATE_TIME,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: true,
    allowsRequired: true,
  },
  MONTH_YEAR: {
    label: 'Month and year',
    description: 'A month within a year, with no particular day.',
    category: CustomTrackingFieldCategory.DATE_TIME,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  YEAR: {
    label: 'Year',
    description: 'A four-digit year.',
    category: CustomTrackingFieldCategory.DATE_TIME,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  DURATION: {
    label: 'Duration',
    description:
      'A length of time, entered as days, hours, minutes and seconds.',
    category: CustomTrackingFieldCategory.DATE_TIME,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  DATE_RANGE: {
    label: 'Date range',
    description: 'A start and end date.',
    category: CustomTrackingFieldCategory.DATE_TIME,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  DATE_TIME_RANGE: {
    label: 'Date and time range',
    description:
      'A start and end moment, kept in UTC with the timezone you entered.',
    category: CustomTrackingFieldCategory.DATE_TIME,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: true,
    allowsRequired: true,
  },
  TOGGLE: {
    label: 'Switch',
    description: 'A yes-or-no answer, shown as a switch.',
    category: CustomTrackingFieldCategory.BOOLEAN,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: false,
  },
  CHECKBOX: {
    label: 'Tick box',
    description: 'A yes-or-no answer, shown as a tick box.',
    category: CustomTrackingFieldCategory.BOOLEAN,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: false,
  },
  RADIO: {
    label: 'Option list',
    description: 'One answer from a list, with every choice visible at once.',
    category: CustomTrackingFieldCategory.CHOICE,
    usesOptions: true,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.OPTIONS,
    usesTimezone: false,
    allowsRequired: true,
  },
  DROPDOWN: {
    label: 'Dropdown',
    description: 'One answer from a list, chosen from a menu.',
    category: CustomTrackingFieldCategory.CHOICE,
    usesOptions: true,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.OPTIONS,
    usesTimezone: false,
    allowsRequired: true,
  },
  CHECKBOX_LIST: {
    label: 'Tick box list',
    description: 'Any number of answers, with every choice visible at once.',
    category: CustomTrackingFieldCategory.CHOICE,
    usesOptions: true,
    allowsMultipleOptions: true,
    defaultSource: CustomTrackingDefaultSource.OPTIONS,
    usesTimezone: false,
    allowsRequired: true,
  },
  MULTI_SELECT: {
    label: 'Multiple select',
    description: 'Any number of answers, chosen from a menu.',
    category: CustomTrackingFieldCategory.CHOICE,
    usesOptions: true,
    allowsMultipleOptions: true,
    defaultSource: CustomTrackingDefaultSource.OPTIONS,
    usesTimezone: false,
    allowsRequired: true,
  },
  YES_NO_UNKNOWN: {
    label: 'Yes, no or unknown',
    description:
      'A yes-or-no answer that can also record that you do not know yet.',
    category: CustomTrackingFieldCategory.CHOICE,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  COLOUR: {
    label: 'Colour',
    description: 'A colour, shown as a swatch alongside its hexadecimal value.',
    category: CustomTrackingFieldCategory.CHOICE,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.VALUE_FRAGMENT,
    usesTimezone: false,
    allowsRequired: true,
  },
  TAGS: {
    label: 'Tags',
    description:
      'Any number of short labels, drawn from a list you define for this field.',
    category: CustomTrackingFieldCategory.CHOICE,
    usesOptions: true,
    allowsMultipleOptions: true,
    defaultSource: CustomTrackingDefaultSource.OPTIONS,
    usesTimezone: false,
    allowsRequired: true,
  },
  IMAGE: {
    label: 'Image',
    description:
      'One picture, cropped to a shape you choose, with a description.',
    category: CustomTrackingFieldCategory.MEDIA,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.NONE,
    usesTimezone: false,
    allowsRequired: true,
  },
  YOUTUBE: {
    label: 'YouTube video',
    description: 'One YouTube video, shown in the same player Storytime uses.',
    category: CustomTrackingFieldCategory.MEDIA,
    usesOptions: false,
    allowsMultipleOptions: false,
    defaultSource: CustomTrackingDefaultSource.NONE,
    usesTimezone: false,
    allowsRequired: true,
  },
} as const satisfies Record<
  CustomTrackingFieldType,
  CustomTrackingFieldTypeSpec
>;

/**
 * The Field types that draw their answers from a user-defined option list.
 *
 * Derived from the catalogue rather than listed again, so a type added with
 * `usesOptions` set cannot be forgotten here.
 */
export const CUSTOM_TRACKING_OPTION_FIELD_TYPES: readonly CustomTrackingFieldType[] =
  Object.entries(CUSTOM_TRACKING_FIELD_CATALOGUE)
    .filter(([, spec]) => spec.usesOptions)
    .map(([type]) => type as CustomTrackingFieldType);

/**
 * The Field types whose values name an IANA timezone.
 */
export const CUSTOM_TRACKING_TIMEZONE_FIELD_TYPES: readonly CustomTrackingFieldType[] =
  Object.entries(CUSTOM_TRACKING_FIELD_CATALOGUE)
    .filter(([, spec]) => spec.usesTimezone)
    .map(([type]) => type as CustomTrackingFieldType);
