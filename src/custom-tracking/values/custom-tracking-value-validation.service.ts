import { BadRequestException, Injectable } from '@nestjs/common';

import { YouTubeUrlService } from 'src/storytime/content/youtube-url.service';

import {
  CUSTOM_TRACKING_HEX_COLOUR_PATTERN,
  CUSTOM_TRACKING_MAX_COLOUR_COMPONENT,
  CUSTOM_TRACKING_PALETTE_TOKENS,
  CUSTOM_TRACKING_RGBA_COLOUR_PATTERN,
} from '../constants/custom-tracking-colour.constants';
import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingValue } from '../constants/custom-tracking-value.interface';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingTriState } from '../enums/custom-tracking-tri-state.enum';
import {
  compareCalendarDates,
  isCalendarDate,
  isWallClockTime,
  isYearInRange,
} from '../shared/custom-tracking-calendar.utility';
import {
  canonicaliseDecimal,
  compareDecimals,
  decimalPlaces,
  isExactDecimal,
} from '../shared/custom-tracking-decimal.utility';
import {
  canonicaliseTimezone,
  toUtcInstant,
} from '../shared/custom-tracking-timezone.utility';

/**
 * A checked answer, ready to be stored.
 */
export interface CustomTrackingValidatedValue {
  /**
   * The typed fragment for the JSONB column.
   *
   * Null for the types whose answer is rows rather than a document.
   */
  fragment: CustomTrackingValue | null;
  /** The options chosen, for the types that draw from a list. */
  optionIds: string[];
}

/** What a caller needs to supply for one Field's answer to be checked. */
export interface CustomTrackingValueSubmission {
  /** The Field being answered. */
  field: CustomTrackingFieldEntity;
  /** Every option the Field has, withdrawn ones included. */
  options: CustomTrackingOptionEntity[];
  /** The options this target had already chosen, if any. */
  previouslyChosenOptionIds: readonly string[];
  /** What the user sent. */
  submitted: unknown;
}

/** The longest any single duration component may be. */
const MAX_DURATION_COMPONENT = 100_000;

/**
 * Checks a submitted answer against the Field it answers.
 *
 * Every rule here has two jobs. The obvious one is refusing what cannot be
 * stored. The other is deciding what "no answer" means, which is subtler and
 * matters more: absence has to stay distinct from `false`, from zero, from an
 * empty selection and from an empty string, because each of those is something
 * a user may have chosen deliberately. Absence is represented by no row at
 * all, so a submission that means "clear this" comes back as nothing and one
 * that means "the answer is false" comes back as a fragment.
 *
 * Values are checked against the Field's stored type and stored configuration,
 * never against anything the request said about them. Trusting either would
 * let a caller have a decimal checked as though it were a date.
 */
@Injectable()
export class CustomTrackingValueValidationService {
  /**
   * Creates an instance of CustomTrackingValueValidationService.
   *
   * @param _youTube - The site's existing YouTube URL parser.
   */
  constructor(private readonly _youTube: YouTubeUrlService) {}

  /**
   * Checks one answer and returns it in the form it will be stored.
   *
   * @param submission - The Field, its options, and what the user sent.
   * @returns The checked answer, or null when the answer is being cleared.
   * @throws BadRequestException when the answer cannot be stored.
   */
  validate(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue | null {
    const { field, submitted } = submission;

    // Absence is the answer being cleared, which is a row removed rather than
    // an empty one written. Distinguishing it from `false` or zero is the
    // whole reason this is checked before anything type-specific runs.
    if (submitted === null || submitted === undefined) {
      return null;
    }

    const checks: Record<
      CustomTrackingFieldType,
      (
        submission: CustomTrackingValueSubmission,
      ) => CustomTrackingValidatedValue
    > = {
      [CustomTrackingFieldType.TEXT_SINGLE_LINE]: s => this.text(s),
      [CustomTrackingFieldType.MARKDOWN]: s => this.markdown(s),
      [CustomTrackingFieldType.INTEGER]: s => this.integer(s),
      [CustomTrackingFieldType.DECIMAL]: s => this.decimal(s),
      [CustomTrackingFieldType.PERCENTAGE]: s => this.decimal(s),
      [CustomTrackingFieldType.RANGE]: s => this.range(s),
      [CustomTrackingFieldType.RATING]: s => this.rating(s),
      [CustomTrackingFieldType.PROGRESS]: s => this.progress(s),
      [CustomTrackingFieldType.DATE]: s => this.date(s),
      [CustomTrackingFieldType.TIME]: s => this.time(s),
      [CustomTrackingFieldType.DATE_TIME]: s => this.dateTime(s),
      [CustomTrackingFieldType.MONTH_YEAR]: s => this.monthYear(s),
      [CustomTrackingFieldType.YEAR]: s => this.year(s),
      [CustomTrackingFieldType.DURATION]: s => this.duration(s),
      [CustomTrackingFieldType.DATE_RANGE]: s => this.dateRange(s),
      [CustomTrackingFieldType.DATE_TIME_RANGE]: s => this.dateTimeRange(s),
      [CustomTrackingFieldType.TOGGLE]: s => this.boolean(s),
      [CustomTrackingFieldType.CHECKBOX]: s => this.boolean(s),
      [CustomTrackingFieldType.RADIO]: s => this.singleChoice(s),
      [CustomTrackingFieldType.DROPDOWN]: s => this.singleChoice(s),
      [CustomTrackingFieldType.CHECKBOX_LIST]: s => this.multipleChoice(s),
      [CustomTrackingFieldType.MULTI_SELECT]: s => this.multipleChoice(s),
      [CustomTrackingFieldType.TAGS]: s => this.multipleChoice(s),
      [CustomTrackingFieldType.YES_NO_UNKNOWN]: s => this.triState(s),
      [CustomTrackingFieldType.COLOUR]: s => this.colour(s),
      [CustomTrackingFieldType.IMAGE]: () => this.refuseImage(),
      [CustomTrackingFieldType.YOUTUBE]: s => this.youTube(s),
    };

    return checks[field.fieldType](submission);
  }

  /**
   * Checks a single line of text.
   *
   * An empty string is a cleared value rather than an answer of nothing.
   * Storing one would make a Field look answered while showing nothing, which
   * is exactly the ambiguity absence is meant to avoid.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private text(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const configuration = this.configurationOf<{
      minLength: number | null;
      maxLength: number | null;
      pattern: string | null;
    }>(submission);
    const text = this.asString(submission, 'text').trim();

    if (text.length === 0) {
      return this.cleared();
    }

    const maximum =
      configuration.maxLength ?? CUSTOM_TRACKING_LIMITS.MAX_TEXT_VALUE_LENGTH;

    if (text.length > maximum) {
      throw new BadRequestException(
        `${submission.field.name} can be at most ${maximum} characters.`,
      );
    }

    if (
      configuration.minLength !== null &&
      text.length < configuration.minLength
    ) {
      throw new BadRequestException(
        `${submission.field.name} needs at least ${configuration.minLength} characters.`,
      );
    }

    if (
      configuration.pattern !== null &&
      !this.matches(configuration.pattern, text)
    ) {
      throw new BadRequestException(
        `${submission.field.name} is not in the expected format.`,
      );
    }

    return { fragment: { text }, optionIds: [] };
  }

  /**
   * Checks a passage of Markdown.
   *
   * The source is stored as written. Rendering is where it is escaped and
   * sanitised, by the same renderer Storytime uses, so nothing an author
   * writes can become markup this application did not emit.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private markdown(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const configuration = this.configurationOf<{ maxLength: number | null }>(
      submission,
    );
    const markdown = this.asString(submission, 'markdown').trim();

    if (markdown.length === 0) {
      return this.cleared();
    }

    const maximum =
      configuration.maxLength ??
      CUSTOM_TRACKING_LIMITS.MAX_MARKDOWN_VALUE_LENGTH;

    if (markdown.length > maximum) {
      throw new BadRequestException(
        `${submission.field.name} can be at most ${maximum} characters.`,
      );
    }

    return { fragment: { markdown }, optionIds: [] };
  }

  /**
   * Checks a whole number.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private integer(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const configuration = this.configurationOf<{
      minimum: number | null;
      maximum: number | null;
      step: number | null;
    }>(submission);
    const integer = this.asNumber(submission, 'integer');

    if (!Number.isInteger(integer)) {
      throw new BadRequestException(
        `${submission.field.name} has to be a whole number.`,
      );
    }

    this.assertWithinNumericBounds(submission, integer, configuration);
    this.assertOnStep(submission, integer, configuration);

    return { fragment: { integer }, optionIds: [] };
  }

  /**
   * Checks a decimal or a percentage.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private decimal(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const configuration = this.configurationOf<{
      minimum: string | null;
      maximum: string | null;
      precision: number;
      step: string | null;
    }>(submission);
    const raw = this.asString(submission, 'decimal').trim();

    if (raw.length === 0) {
      return this.cleared();
    }

    if (!isExactDecimal(raw)) {
      throw new BadRequestException(
        `${submission.field.name} has to be a number written out in full, sent as text so its exact value is kept.`,
      );
    }

    if (decimalPlaces(raw) > configuration.precision) {
      throw new BadRequestException(
        `${submission.field.name} keeps ${configuration.precision} decimal place${configuration.precision === 1 ? '' : 's'}.`,
      );
    }

    const decimal = canonicaliseDecimal(raw) as string;

    if (
      configuration.minimum !== null &&
      compareDecimals(decimal, configuration.minimum) < 0
    ) {
      throw new BadRequestException(
        `${submission.field.name} cannot be below ${configuration.minimum}.`,
      );
    }

    if (
      configuration.maximum !== null &&
      compareDecimals(decimal, configuration.maximum) > 0
    ) {
      throw new BadRequestException(
        `${submission.field.name} cannot be above ${configuration.maximum}.`,
      );
    }

    return { fragment: { decimal }, optionIds: [] };
  }

  /**
   * Checks a number chosen on a slider.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private range(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const configuration = this.configurationOf<{
      minimum: number;
      maximum: number;
      step: number;
    }>(submission);
    const value = this.asNumber(submission, 'number');

    if (value < configuration.minimum || value > configuration.maximum) {
      throw new BadRequestException(
        `${submission.field.name} has to be between ${configuration.minimum} and ${configuration.maximum}.`,
      );
    }

    this.assertOnStep(submission, value, {
      minimum: configuration.minimum,
      step: configuration.step,
    });

    return { fragment: { number: value }, optionIds: [] };
  }

  /**
   * Checks a rating.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private rating(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const { maximum } = this.configurationOf<{ maximum: number }>(submission);
    const rating = this.asNumber(submission, 'rating');

    if (!Number.isInteger(rating) || rating < 1 || rating > maximum) {
      throw new BadRequestException(
        `${submission.field.name} has to be a whole number between 1 and ${maximum}.`,
      );
    }

    return { fragment: { rating }, optionIds: [] };
  }

  /**
   * Checks a progress figure and its total.
   *
   * Both are stored. The total is not read from the Field's configuration at
   * render time, so a user who later raises the configured ceiling does not
   * find every value they had recorded silently restated against it.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private progress(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const configuration = this.configurationOf<{
      minimum: number | null;
      maximum: number | null;
    }>(submission);
    const supplied = this.asObject(submission);
    const current = this.numberProperty(submission, supplied, 'current');
    const maximum = this.numberProperty(submission, supplied, 'maximum');

    if (maximum <= 0) {
      throw new BadRequestException(
        `${submission.field.name} needs a total greater than zero.`,
      );
    }

    if (current > maximum) {
      throw new BadRequestException(
        `${submission.field.name} cannot be further along than its total.`,
      );
    }

    if (configuration.minimum !== null && current < configuration.minimum) {
      throw new BadRequestException(
        `${submission.field.name} cannot be below ${configuration.minimum}.`,
      );
    }

    if (configuration.maximum !== null && maximum > configuration.maximum) {
      throw new BadRequestException(
        `${submission.field.name} cannot have a total above ${configuration.maximum}.`,
      );
    }

    return { fragment: { current, maximum }, optionIds: [] };
  }

  /**
   * Checks a calendar date.
   *
   * Never converted to an instant. The fourth of September is the fourth of
   * September wherever it is read.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private date(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const configuration = this.configurationOf<{
      minimumDate: string | null;
      maximumDate: string | null;
    }>(submission);
    const date = this.asString(submission, 'date').trim();

    if (date.length === 0) {
      return this.cleared();
    }

    this.assertCalendarDate(submission, date);
    this.assertWithinDateBounds(submission, date, configuration);

    return { fragment: { date }, optionIds: [] };
  }

  /**
   * Checks a time of day and the timezone it is expressed in.
   *
   * Never converted to UTC. A time without a date is not an instant, so
   * converting it would be a guess, and the guess would be wrong twice a year.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private time(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const supplied = this.asObject(submission);
    const time = this.stringProperty(submission, supplied, 'time').trim();

    if (time.length === 0) {
      return this.cleared();
    }

    if (!isWallClockTime(time)) {
      throw new BadRequestException(
        `${submission.field.name} needs a time written as HH:mm.`,
      );
    }

    return {
      fragment: { time, timezone: this.timezoneOf(submission, supplied) },
      optionIds: [],
    };
  }

  /**
   * Checks a complete moment in time.
   *
   * Converted to UTC so it can be compared and ordered, with the timezone kept
   * beside it so the local time the user entered can be reconstructed. A UTC
   * instant alone cannot do that across a daylight-saving change.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private dateTime(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const supplied = this.asObject(submission);
    const local = this.stringProperty(
      submission,
      supplied,
      'localDateTime',
    ).trim();

    if (local.length === 0) {
      return this.cleared();
    }

    const timezone = this.timezoneOf(submission, supplied);

    return {
      fragment: {
        instant: this.toInstant(submission, local, timezone).toISOString(),
        timezone,
      },
      optionIds: [],
    };
  }

  /**
   * Checks a month within a year.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private monthYear(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const supplied = this.asObject(submission);
    const year = this.numberProperty(submission, supplied, 'year');
    const month = this.numberProperty(submission, supplied, 'month');

    if (!isYearInRange(year)) {
      throw new BadRequestException(
        `${submission.field.name} needs a four-digit year.`,
      );
    }

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException(
        `${submission.field.name} needs a month between 1 and 12.`,
      );
    }

    return { fragment: { year, month }, optionIds: [] };
  }

  /**
   * Checks a year.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private year(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const configuration = this.configurationOf<{
      minimumYear: number | null;
      maximumYear: number | null;
    }>(submission);
    const year = this.asNumber(submission, 'year');

    if (!isYearInRange(year)) {
      throw new BadRequestException(
        `${submission.field.name} needs a four-digit year.`,
      );
    }

    if (
      configuration.minimumYear !== null &&
      year < configuration.minimumYear
    ) {
      throw new BadRequestException(
        `${submission.field.name} cannot be before ${configuration.minimumYear}.`,
      );
    }

    if (
      configuration.maximumYear !== null &&
      year > configuration.maximumYear
    ) {
      throw new BadRequestException(
        `${submission.field.name} cannot be after ${configuration.maximumYear}.`,
      );
    }

    return { fragment: { year }, optionIds: [] };
  }

  /**
   * Checks a length of time.
   *
   * Held as its components rather than as a total. "Two days" and
   * "forty-eight hours" are different statements, and a user who wrote one
   * should not be shown the other.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private duration(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const configuration = this.configurationOf<{
      includeDays: boolean;
      includeHours: boolean;
      includeMinutes: boolean;
      includeSeconds: boolean;
    }>(submission);
    const supplied = this.asObject(submission);

    const components = {
      days: this.durationComponent(
        submission,
        supplied,
        'days',
        configuration.includeDays,
      ),
      hours: this.durationComponent(
        submission,
        supplied,
        'hours',
        configuration.includeHours,
      ),
      minutes: this.durationComponent(
        submission,
        supplied,
        'minutes',
        configuration.includeMinutes,
      ),
      seconds: this.durationComponent(
        submission,
        supplied,
        'seconds',
        configuration.includeSeconds,
      ),
    };

    return { fragment: components, optionIds: [] };
  }

  /**
   * Checks a start and end date.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private dateRange(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const configuration = this.configurationOf<{
      minimumDate: string | null;
      maximumDate: string | null;
    }>(submission);
    const supplied = this.asObject(submission);
    const startDate = this.stringProperty(submission, supplied, 'startDate');
    const endDate = this.stringProperty(submission, supplied, 'endDate');

    this.assertCalendarDate(submission, startDate);
    this.assertCalendarDate(submission, endDate);
    this.assertWithinDateBounds(submission, startDate, configuration);
    this.assertWithinDateBounds(submission, endDate, configuration);

    if (compareCalendarDates(startDate, endDate) > 0) {
      throw new BadRequestException(
        `${submission.field.name} cannot end before it starts.`,
      );
    }

    return { fragment: { startDate, endDate }, optionIds: [] };
  }

  /**
   * Checks a start and end moment.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private dateTimeRange(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const supplied = this.asObject(submission);
    const timezone = this.timezoneOf(submission, supplied);
    const start = this.toInstant(
      submission,
      this.stringProperty(submission, supplied, 'startLocalDateTime'),
      timezone,
    );
    const end = this.toInstant(
      submission,
      this.stringProperty(submission, supplied, 'endLocalDateTime'),
      timezone,
    );

    if (start.getTime() > end.getTime()) {
      throw new BadRequestException(
        `${submission.field.name} cannot end before it starts.`,
      );
    }

    return {
      fragment: {
        startInstant: start.toISOString(),
        endInstant: end.toISOString(),
        timezone,
      },
      optionIds: [],
    };
  }

  /**
   * Checks a yes-or-no answer.
   *
   * `false` is an answer, not an absence, so it is stored like any other.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private boolean(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const supplied = this.asObject(submission);
    const value = supplied.boolean;

    if (typeof value !== 'boolean') {
      throw new BadRequestException(
        `${submission.field.name} has to be yes or no.`,
      );
    }

    return { fragment: { boolean: value }, optionIds: [] };
  }

  /**
   * Checks a yes, no or explicitly unknown answer.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private triState(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const supplied = this.asObject(submission);
    const value = supplied.triState;

    if (
      typeof value !== 'string' ||
      !Object.values(CustomTrackingTriState).includes(
        value as CustomTrackingTriState,
      )
    ) {
      throw new BadRequestException(
        `${submission.field.name} has to be yes, no or unknown.`,
      );
    }

    return {
      fragment: { triState: value as CustomTrackingTriState },
      optionIds: [],
    };
  }

  /**
   * Checks a colour.
   *
   * A palette name or a literal, never both. Storing the name where one fits
   * is what lets a value follow the palette if it is ever adjusted.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private colour(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const supplied = this.asObject(submission);
    const token = supplied.token ?? null;
    const literal = supplied.literal ?? null;

    if ((token === null) === (literal === null)) {
      throw new BadRequestException(
        `${submission.field.name} needs either one of the site's colours or a colour of your own, not both.`,
      );
    }

    if (token !== null) {
      if (
        typeof token !== 'string' ||
        !CUSTOM_TRACKING_PALETTE_TOKENS.has(token)
      ) {
        throw new BadRequestException(
          `${submission.field.name} does not recognise that colour name.`,
        );
      }

      return { fragment: { token, literal: null }, optionIds: [] };
    }

    return {
      fragment: {
        token: null,
        literal: this.colourLiteral(submission, literal),
      },
      optionIds: [],
    };
  }

  /**
   * Checks one option chosen from a list.
   *
   * @param submission - The Field, its options and what the user sent.
   * @returns The checked answer.
   */
  private singleChoice(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const optionIds = this.chosenOptionIds(submission);

    if (optionIds.length === 0) {
      return this.cleared();
    }

    if (optionIds.length > 1) {
      throw new BadRequestException(
        `${submission.field.name} takes one answer.`,
      );
    }

    this.assertChoosable(submission, optionIds);

    return { fragment: null, optionIds };
  }

  /**
   * Checks any number of options chosen from a list.
   *
   * @param submission - The Field, its options and what the user sent.
   * @returns The checked answer.
   */
  private multipleChoice(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const configuration = this.configurationOf<{
      minimumSelections: number | null;
      maximumSelections: number | null;
    }>(submission);
    const optionIds = this.chosenOptionIds(submission);

    if (optionIds.length === 0) {
      return this.cleared();
    }

    if (optionIds.length > CUSTOM_TRACKING_LIMITS.MAX_TAGS_PER_VALUE) {
      throw new BadRequestException(
        `${submission.field.name} takes at most ${CUSTOM_TRACKING_LIMITS.MAX_TAGS_PER_VALUE} answers.`,
      );
    }

    if (
      configuration.minimumSelections !== null &&
      optionIds.length < configuration.minimumSelections
    ) {
      throw new BadRequestException(
        `${submission.field.name} needs at least ${configuration.minimumSelections} answers.`,
      );
    }

    if (
      configuration.maximumSelections !== null &&
      optionIds.length > configuration.maximumSelections
    ) {
      throw new BadRequestException(
        `${submission.field.name} takes at most ${configuration.maximumSelections} answers.`,
      );
    }

    this.assertChoosable(submission, optionIds);

    return { fragment: null, optionIds };
  }

  /**
   * Checks a YouTube video.
   *
   * Parsed by the site's existing validator, and only what that produced is
   * stored: an eleven-character identifier and an optional offset. The URL the
   * user pasted never reaches the page, because the embed is built by the
   * application from the identifier.
   *
   * @param submission - The Field and what the user sent.
   * @returns The checked answer.
   */
  private youTube(
    submission: CustomTrackingValueSubmission,
  ): CustomTrackingValidatedValue {
    const supplied = this.asObject(submission);
    const url = this.stringProperty(submission, supplied, 'url').trim();

    if (url.length === 0) {
      return this.cleared();
    }

    const parsed = this._youTube.parse(url);

    if (!parsed) {
      throw new BadRequestException(
        `${submission.field.name} needs a link to a YouTube video.`,
      );
    }

    return {
      fragment: {
        videoId: parsed.videoId,
        startSeconds: parsed.startSeconds,
      },
      optionIds: [],
    };
  }

  /**
   * Refuses an attempt to set a picture through the ordinary value route.
   *
   * A picture arrives as an upload, is checked as bytes, and is stored in
   * Cloudflare before anything is written here. Accepting an identifier in a
   * value payload would let a caller point a Field at any image in the account.
   *
   * @throws BadRequestException always.
   */
  private refuseImage(): never {
    throw new BadRequestException(
      'Pictures are set by uploading them, not by sending a value.',
    );
  }

  /**
   * Returns the answer meaning "no answer".
   *
   * @returns Null, which the caller stores as no row at all.
   */
  private cleared(): CustomTrackingValidatedValue {
    return { fragment: null, optionIds: [] };
  }

  /**
   * Reads the Field's stored configuration.
   *
   * @param submission - The submission being checked.
   * @returns The configuration, typed for the check that wants it.
   */
  private configurationOf<T>(submission: CustomTrackingValueSubmission): T {
    return submission.field.configuration as unknown as T;
  }

  /**
   * Requires the submission to be an object.
   *
   * @param submission - The submission being checked.
   * @returns The submission as a plain object.
   * @throws BadRequestException when it is anything else.
   */
  private asObject(
    submission: CustomTrackingValueSubmission,
  ): Record<string, unknown> {
    const supplied = submission.submitted;

    if (
      typeof supplied !== 'object' ||
      supplied === null ||
      Array.isArray(supplied)
    ) {
      throw new BadRequestException(
        `${submission.field.name} was not sent in the expected form.`,
      );
    }

    return supplied as Record<string, unknown>;
  }

  /**
   * Reads a string property from the submission.
   *
   * @param submission - The submission being checked.
   * @param property - The property wanted.
   * @returns The string.
   * @throws BadRequestException when it is absent or not a string.
   */
  private asString(
    submission: CustomTrackingValueSubmission,
    property: string,
  ): string {
    return this.stringProperty(submission, this.asObject(submission), property);
  }

  /**
   * Reads a number property from the submission.
   *
   * @param submission - The submission being checked.
   * @param property - The property wanted.
   * @returns The number.
   * @throws BadRequestException when it is absent or not a number.
   */
  private asNumber(
    submission: CustomTrackingValueSubmission,
    property: string,
  ): number {
    return this.numberProperty(submission, this.asObject(submission), property);
  }

  /**
   * Reads a string from an object.
   *
   * @param submission - The submission being checked.
   * @param supplied - The object read from.
   * @param property - The property wanted.
   * @returns The string.
   * @throws BadRequestException when it is absent or not a string.
   */
  private stringProperty(
    submission: CustomTrackingValueSubmission,
    supplied: Record<string, unknown>,
    property: string,
  ): string {
    const value = supplied[property];

    if (typeof value !== 'string') {
      throw new BadRequestException(
        `${submission.field.name} was not sent in the expected form.`,
      );
    }

    return value;
  }

  /**
   * Reads a finite number from an object.
   *
   * `NaN` and the infinities are refused here rather than left to a later
   * comparison, where every bound check involving them silently passes.
   *
   * @param submission - The submission being checked.
   * @param supplied - The object read from.
   * @param property - The property wanted.
   * @returns The number.
   * @throws BadRequestException when it is absent or not a finite number.
   */
  private numberProperty(
    submission: CustomTrackingValueSubmission,
    supplied: Record<string, unknown>,
    property: string,
  ): number {
    const value = supplied[property];

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(
        `${submission.field.name} was not sent in the expected form.`,
      );
    }

    return value;
  }

  /**
   * Reads one component of a duration.
   *
   * A unit the Field does not ask for has to be absent or zero. Accepting a
   * value there would store something no editor would ever show back.
   *
   * @param submission - The submission being checked.
   * @param supplied - The object read from.
   * @param property - The component wanted.
   * @param included - Whether the Field asks for this unit.
   * @returns The component.
   * @throws BadRequestException when it is out of range or not asked for.
   */
  private durationComponent(
    submission: CustomTrackingValueSubmission,
    supplied: Record<string, unknown>,
    property: string,
    included: boolean,
  ): number {
    const value = supplied[property] ?? 0;

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new BadRequestException(
        `${submission.field.name} needs whole numbers of ${property}, none of them negative.`,
      );
    }

    if (!included && value !== 0) {
      throw new BadRequestException(
        `${submission.field.name} is not measured in ${property}.`,
      );
    }

    if (value > MAX_DURATION_COMPONENT) {
      throw new BadRequestException(
        `${submission.field.name} cannot hold that many ${property}.`,
      );
    }

    return value;
  }

  /**
   * Reads the timezone a value was entered in.
   *
   * The Field's default is used when the value names none, so an editor that
   * did not offer the choice still records something answerable.
   *
   * @param submission - The submission being checked.
   * @param supplied - The object read from.
   * @returns The canonical IANA identifier.
   * @throws BadRequestException when the identifier is unusable.
   */
  private timezoneOf(
    submission: CustomTrackingValueSubmission,
    supplied: Record<string, unknown>,
  ): string {
    const configuration = this.configurationOf<{ defaultTimezone: string }>(
      submission,
    );
    const requested = supplied.timezone ?? configuration.defaultTimezone;
    const canonical =
      typeof requested === 'string' ? canonicaliseTimezone(requested) : null;

    if (!canonical) {
      throw new BadRequestException(
        `${submission.field.name} needs an IANA timezone such as Europe/London.`,
      );
    }

    return canonical;
  }

  /**
   * Converts a local date and time into the instant it names.
   *
   * @param submission - The submission being checked.
   * @param local - The local date and time.
   * @param timezone - The timezone it is expressed in.
   * @returns The instant.
   * @throws BadRequestException when the local time does not exist there.
   */
  private toInstant(
    submission: CustomTrackingValueSubmission,
    local: string,
    timezone: string,
  ): Date {
    const instant = toUtcInstant(local.trim(), timezone);

    if (!instant) {
      throw new BadRequestException(
        `${submission.field.name} does not have a time of ${local.trim()} in ${timezone}. Clocks may have gone forward.`,
      );
    }

    return instant;
  }

  /**
   * Requires a date to be one that exists.
   *
   * @param submission - The submission being checked.
   * @param date - The candidate date.
   * @throws BadRequestException when it is not a real date.
   */
  private assertCalendarDate(
    submission: CustomTrackingValueSubmission,
    date: string,
  ): void {
    if (!isCalendarDate(date)) {
      throw new BadRequestException(
        `${submission.field.name} needs a date that exists, written as YYYY-MM-DD.`,
      );
    }
  }

  /**
   * Requires a date to fall within the Field's bounds.
   *
   * @param submission - The submission being checked.
   * @param date - The candidate date.
   * @param bounds - The Field's configured bounds.
   * @throws BadRequestException when it falls outside them.
   */
  private assertWithinDateBounds(
    submission: CustomTrackingValueSubmission,
    date: string,
    bounds: { minimumDate: string | null; maximumDate: string | null },
  ): void {
    if (
      bounds.minimumDate !== null &&
      compareCalendarDates(date, bounds.minimumDate) < 0
    ) {
      throw new BadRequestException(
        `${submission.field.name} cannot be before ${bounds.minimumDate}.`,
      );
    }

    if (
      bounds.maximumDate !== null &&
      compareCalendarDates(date, bounds.maximumDate) > 0
    ) {
      throw new BadRequestException(
        `${submission.field.name} cannot be after ${bounds.maximumDate}.`,
      );
    }
  }

  /**
   * Requires a number to fall within the Field's bounds.
   *
   * @param submission - The submission being checked.
   * @param value - The candidate number.
   * @param bounds - The Field's configured bounds.
   * @throws BadRequestException when it falls outside them.
   */
  private assertWithinNumericBounds(
    submission: CustomTrackingValueSubmission,
    value: number,
    bounds: { minimum: number | null; maximum: number | null },
  ): void {
    if (bounds.minimum !== null && value < bounds.minimum) {
      throw new BadRequestException(
        `${submission.field.name} cannot be below ${bounds.minimum}.`,
      );
    }

    if (bounds.maximum !== null && value > bounds.maximum) {
      throw new BadRequestException(
        `${submission.field.name} cannot be above ${bounds.maximum}.`,
      );
    }
  }

  /**
   * Requires a number to sit on the Field's step.
   *
   * Counted from the minimum where there is one, so a Field stepping by five
   * from three accepts three, eight and thirteen rather than five and ten.
   *
   * @param submission - The submission being checked.
   * @param value - The candidate number.
   * @param bounds - The Field's configured minimum and step.
   * @throws BadRequestException when it falls between steps.
   */
  private assertOnStep(
    submission: CustomTrackingValueSubmission,
    value: number,
    bounds: { minimum: number | null; step: number | null },
  ): void {
    if (bounds.step === null) {
      return;
    }

    const offset = value - (bounds.minimum ?? 0);

    // Compared against a rounded multiple rather than with a remainder, since
    // a remainder of a fractional step lands on a floating-point residue that
    // is never exactly zero.
    const steps = Math.round(offset / bounds.step);

    if (
      Math.abs(steps * bounds.step - offset) >
      Number.EPSILON * Math.abs(offset || 1)
    ) {
      throw new BadRequestException(
        `${submission.field.name} goes up in steps of ${bounds.step}.`,
      );
    }
  }

  /**
   * Reads the option identifiers a submission chose.
   *
   * @param submission - The submission being checked.
   * @returns The identifiers, de-duplicated in the order they were given.
   * @throws BadRequestException when they are not a list of identifiers.
   */
  private chosenOptionIds(submission: CustomTrackingValueSubmission): string[] {
    const supplied = this.asObject(submission);
    const optionIds = supplied.optionIds;

    if (!Array.isArray(optionIds)) {
      throw new BadRequestException(
        `${submission.field.name} was not sent in the expected form.`,
      );
    }

    if (optionIds.some(id => typeof id !== 'string')) {
      throw new BadRequestException(
        `${submission.field.name} was not sent in the expected form.`,
      );
    }

    return [...new Set(optionIds as string[])];
  }

  /**
   * Requires every chosen option to be one this Field offers, and one that may
   * still be chosen.
   *
   * A withdrawn option is allowed only where it was already chosen. That is
   * what lets a user keep an answer they gave before the option was withdrawn,
   * while stopping anybody choosing it afresh.
   *
   * @param submission - The submission being checked.
   * @param optionIds - The options chosen.
   * @throws BadRequestException when an option is unknown or withdrawn.
   */
  private assertChoosable(
    submission: CustomTrackingValueSubmission,
    optionIds: string[],
  ): void {
    const byId = new Map(
      submission.options.map(option => [option.id, option] as const),
    );
    const previously = new Set(submission.previouslyChosenOptionIds);

    for (const optionId of optionIds) {
      const option = byId.get(optionId);

      if (!option) {
        throw new BadRequestException(
          `${submission.field.name} does not offer one of those answers.`,
        );
      }

      if (option.deletedAt !== null && !previously.has(optionId)) {
        throw new BadRequestException(
          `“${option.label}” is no longer offered for ${submission.field.name}.`,
        );
      }
    }
  }

  /**
   * Checks a colour written out rather than named.
   *
   * @param submission - The submission being checked.
   * @param literal - The candidate colour.
   * @returns The colour, in its canonical spelling.
   * @throws BadRequestException when it is not a colour this feature stores.
   */
  private colourLiteral(
    submission: CustomTrackingValueSubmission,
    literal: unknown,
  ): string {
    if (typeof literal !== 'string') {
      throw new BadRequestException(
        `${submission.field.name} needs a colour written as #RRGGBB or rgba(...).`,
      );
    }

    const candidate = literal.trim();

    if (CUSTOM_TRACKING_HEX_COLOUR_PATTERN.test(candidate)) {
      return this.expandHex(candidate);
    }

    const rgba = CUSTOM_TRACKING_RGBA_COLOUR_PATTERN.exec(candidate);

    if (
      rgba &&
      [rgba[1], rgba[2], rgba[3]].every(
        component => Number(component) <= CUSTOM_TRACKING_MAX_COLOUR_COMPONENT,
      )
    ) {
      return candidate;
    }

    throw new BadRequestException(
      `${submission.field.name} needs a colour written as #RRGGBB or rgba(...).`,
    );
  }

  /**
   * Writes a three-digit hexadecimal colour out in full.
   *
   * Stored expanded and lower-cased so two spellings of the same colour do not
   * both exist.
   *
   * @param candidate - The colour, already known to be hexadecimal.
   * @returns The six-digit form.
   */
  private expandHex(candidate: string): string {
    const digits = candidate.slice(1).toLowerCase();

    if (digits.length === 3) {
      return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
    }

    return `#${digits}`;
  }

  /**
   * Runs a user-written pattern against a value.
   *
   * The pattern was compiled once when the Field was configured, so an
   * unusable one never reaches here; this compiles it again because a
   * `RegExp` carrying state between uses is a source of intermittent wrong
   * answers.
   *
   * @param pattern - The pattern's source.
   * @param text - The value to test.
   * @returns True when the value matches.
   */
  private matches(pattern: string, text: string): boolean {
    return new RegExp(pattern).test(text);
  }
}
