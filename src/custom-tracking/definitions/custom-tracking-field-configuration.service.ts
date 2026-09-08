import { BadRequestException, Injectable } from '@nestjs/common';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CustomTrackingFieldConfiguration } from '../constants/custom-tracking-field-configuration.interface';
import {
  ImageConfigurationDto,
  MultipleChoiceConfigurationDto,
} from '../dto/configuration/choice-configuration.dto';
import {
  DateConfigurationDto,
  DateTimeConfigurationDto,
  DurationConfigurationDto,
  MonthYearConfigurationDto,
  TimeConfigurationDto,
  YearConfigurationDto,
} from '../dto/configuration/date-time-configuration.dto';
import {
  DecimalConfigurationDto,
  IntegerConfigurationDto,
  ProgressConfigurationDto,
  RangeConfigurationDto,
  RatingConfigurationDto,
} from '../dto/configuration/number-configuration.dto';
import {
  EmptyConfigurationDto,
  MarkdownConfigurationDto,
  TextConfigurationDto,
} from '../dto/configuration/text-configuration.dto';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { compareCalendarDates } from '../shared/custom-tracking-calendar.utility';
import {
  canonicaliseDecimal,
  compareDecimals,
  decimalPlaces,
} from '../shared/custom-tracking-decimal.utility';
import { canonicaliseTimezone } from '../shared/custom-tracking-timezone.utility';

/** The largest and smallest a percentage may be. */
const PERCENTAGE_MINIMUM = '0';
const PERCENTAGE_MAXIMUM = '100';

/**
 * Which class validates each Field type's configuration.
 *
 * Every type appears, including the ones with nothing to configure. A type
 * absent from this map would be one whose configuration nothing checked, and
 * since the column is JSONB, unchecked means anything at all.
 *
 * Several types share a class. A date range is bounded and written exactly as
 * a date is, and a tick-box list is bounded exactly as a multiple-select menu;
 * giving each its own identical class would state the same rules twice and
 * invite them to drift apart.
 */
const CONFIGURATION_CLASSES: Record<CustomTrackingFieldType, new () => object> =
  {
    [CustomTrackingFieldType.TEXT_SINGLE_LINE]: TextConfigurationDto,
    [CustomTrackingFieldType.MARKDOWN]: MarkdownConfigurationDto,
    [CustomTrackingFieldType.INTEGER]: IntegerConfigurationDto,
    [CustomTrackingFieldType.DECIMAL]: DecimalConfigurationDto,
    [CustomTrackingFieldType.PERCENTAGE]: DecimalConfigurationDto,
    [CustomTrackingFieldType.RANGE]: RangeConfigurationDto,
    [CustomTrackingFieldType.RATING]: RatingConfigurationDto,
    [CustomTrackingFieldType.PROGRESS]: ProgressConfigurationDto,
    [CustomTrackingFieldType.DATE]: DateConfigurationDto,
    [CustomTrackingFieldType.TIME]: TimeConfigurationDto,
    [CustomTrackingFieldType.DATE_TIME]: DateTimeConfigurationDto,
    [CustomTrackingFieldType.MONTH_YEAR]: MonthYearConfigurationDto,
    [CustomTrackingFieldType.YEAR]: YearConfigurationDto,
    [CustomTrackingFieldType.DURATION]: DurationConfigurationDto,
    [CustomTrackingFieldType.DATE_RANGE]: DateConfigurationDto,
    [CustomTrackingFieldType.DATE_TIME_RANGE]: DateTimeConfigurationDto,
    [CustomTrackingFieldType.TOGGLE]: EmptyConfigurationDto,
    [CustomTrackingFieldType.CHECKBOX]: EmptyConfigurationDto,
    [CustomTrackingFieldType.RADIO]: EmptyConfigurationDto,
    [CustomTrackingFieldType.DROPDOWN]: EmptyConfigurationDto,
    [CustomTrackingFieldType.CHECKBOX_LIST]: MultipleChoiceConfigurationDto,
    [CustomTrackingFieldType.MULTI_SELECT]: MultipleChoiceConfigurationDto,
    [CustomTrackingFieldType.YES_NO_UNKNOWN]: EmptyConfigurationDto,
    [CustomTrackingFieldType.COLOUR]: EmptyConfigurationDto,
    [CustomTrackingFieldType.TAGS]: MultipleChoiceConfigurationDto,
    [CustomTrackingFieldType.IMAGE]: ImageConfigurationDto,
    [CustomTrackingFieldType.YOUTUBE]: EmptyConfigurationDto,
  };

/**
 * Checks and normalises the type-specific part of a Field definition.
 *
 * The configuration lives in a JSONB column, which PostgreSQL will accept any
 * shape into. There is no schema underneath to fall back on, so this is the
 * only thing standing between a definition and a configuration that nothing
 * can render — which is why an unrecognised property is refused outright
 * rather than ignored.
 *
 * Normalisation matters as much as checking. Decimals come back in their
 * canonical spelling and timezones in the runtime's, so two definitions that
 * mean the same thing are stored the same way and a value validated against
 * one is validated against the other identically.
 */
@Injectable()
export class CustomTrackingFieldConfigurationService {
  /**
   * Validates a configuration against its Field type and returns it normalised.
   *
   * @param fieldType - The type the configuration belongs to.
   * @param configuration - The configuration as it arrived.
   * @returns The configuration, checked and normalised.
   * @throws BadRequestException when it does not describe a usable Field.
   */
  validate(
    fieldType: CustomTrackingFieldType,
    configuration: unknown,
  ): CustomTrackingFieldConfiguration {
    const supplied = this.asObject(configuration);
    const configurationClass = CONFIGURATION_CLASSES[fieldType];
    const instance = plainToInstance(configurationClass, supplied);

    // `forbidNonWhitelisted` is what refuses a setting the type does not have,
    // and it is the check that stops configuration being smuggled into a JSONB
    // column with no schema under it.
    //
    // `forbidUnknownValues` has to be off for it to work here. That option
    // rejects any object whose class carries no validation metadata, which
    // describes the several types that have no settings at all — with it on,
    // their one valid configuration, the empty one, is refused. It exists to
    // stop an arbitrary payload being validated against nothing; that is not
    // the situation, because the class is chosen from the map above by field
    // type and never named by the request.
    const errors = validateSync(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: false,
    });

    if (errors.length > 0) {
      // Spread rather than a fallback for the absent case. `constraints` is
      // only ever undefined on the parent of a nested failure, which none of
      // these flat configuration classes can produce, so a fallback would be a
      // branch no test could reach; spreading nothing yields an empty object
      // and needs no branch at all.
      throw new BadRequestException(
        errors.flatMap(error => Object.values({ ...error.constraints })),
      );
    }

    this.assertCoherent(fieldType, instance as Record<string, unknown>);

    return this.normalise(
      fieldType,
      instance as Record<string, unknown>,
    ) as CustomTrackingFieldConfiguration;
  }

  /**
   * Requires the configuration to be an object rather than anything else JSON
   * permits.
   *
   * @param configuration - The configuration as it arrived.
   * @returns The configuration as a plain object.
   * @throws BadRequestException when it is not one.
   */
  private asObject(configuration: unknown): Record<string, unknown> {
    if (
      typeof configuration !== 'object' ||
      configuration === null ||
      Array.isArray(configuration)
    ) {
      throw new BadRequestException('Field configuration must be an object.');
    }

    return configuration as Record<string, unknown>;
  }

  /**
   * Applies the rules that relate one setting to another.
   *
   * Decorators can say that a bound is a number; they cannot say that the
   * lower one has to be below the upper. Every rule here is of that kind.
   *
   * @param fieldType - The type being configured.
   * @param configuration - The configuration, already checked property by
   *   property.
   * @throws BadRequestException when the settings contradict one another.
   */
  private assertCoherent(
    fieldType: CustomTrackingFieldType,
    configuration: Record<string, unknown>,
  ): void {
    const checks: Partial<
      Record<CustomTrackingFieldType, (value: Record<string, unknown>) => void>
    > = {
      [CustomTrackingFieldType.TEXT_SINGLE_LINE]: value =>
        this.assertText(value),
      [CustomTrackingFieldType.INTEGER]: value =>
        this.assertNumericBounds(value),
      [CustomTrackingFieldType.PROGRESS]: value =>
        this.assertNumericBounds(value),
      [CustomTrackingFieldType.DECIMAL]: value => this.assertDecimal(value),
      [CustomTrackingFieldType.PERCENTAGE]: value =>
        this.assertPercentage(value),
      [CustomTrackingFieldType.RANGE]: value => this.assertRange(value),
      [CustomTrackingFieldType.DATE]: value => this.assertDateBounds(value),
      [CustomTrackingFieldType.DATE_RANGE]: value =>
        this.assertDateBounds(value),
      [CustomTrackingFieldType.YEAR]: value => this.assertYearBounds(value),
      [CustomTrackingFieldType.DURATION]: value => this.assertDuration(value),
      [CustomTrackingFieldType.CHECKBOX_LIST]: value =>
        this.assertSelectionBounds(value),
      [CustomTrackingFieldType.MULTI_SELECT]: value =>
        this.assertSelectionBounds(value),
      [CustomTrackingFieldType.TAGS]: value =>
        this.assertSelectionBounds(value),
    };

    checks[fieldType]?.(configuration);
  }

  /**
   * Requires a text Field's length bounds and pattern to be usable.
   *
   * @param configuration - The text configuration.
   * @throws BadRequestException when the bounds cross or the pattern will not
   *   compile.
   */
  private assertText(configuration: Record<string, unknown>): void {
    const minLength = configuration.minLength as number | null;
    const maxLength = configuration.maxLength as number | null;

    if (minLength !== null && maxLength !== null && minLength > maxLength) {
      throw new BadRequestException(
        'The shortest length allowed cannot be longer than the longest.',
      );
    }

    const pattern = configuration.pattern as string | null;

    if (pattern === null) {
      return;
    }

    try {
      // Compiled once here so an unusable pattern is refused while the user is
      // still looking at the form, rather than failing every value they later
      // try to save against it.
      new RegExp(pattern);
    } catch {
      throw new BadRequestException(
        'That validation pattern is not a valid regular expression.',
      );
    }
  }

  /**
   * Requires a numeric Field's bounds not to cross.
   *
   * @param configuration - The numeric configuration.
   * @throws BadRequestException when the minimum exceeds the maximum.
   */
  private assertNumericBounds(configuration: Record<string, unknown>): void {
    const minimum = configuration.minimum as number | null;
    const maximum = configuration.maximum as number | null;

    if (minimum !== null && maximum !== null && minimum > maximum) {
      throw new BadRequestException(
        'The smallest value allowed cannot be larger than the largest.',
      );
    }
  }

  /**
   * Requires a decimal Field's bounds and step to agree with its precision.
   *
   * @param configuration - The decimal configuration.
   * @throws BadRequestException when the settings contradict one another.
   */
  private assertDecimal(configuration: Record<string, unknown>): void {
    const minimum = configuration.minimum as string | null;
    const maximum = configuration.maximum as string | null;
    const step = configuration.step as string | null;
    const precision = configuration.precision as number;

    if (
      minimum !== null &&
      maximum !== null &&
      compareDecimals(minimum, maximum) > 0
    ) {
      throw new BadRequestException(
        'The smallest value allowed cannot be larger than the largest.',
      );
    }

    // A step finer than the precision could never be landed on, because every
    // value is rounded to the precision before it is stored.
    if (step !== null && decimalPlaces(step) > precision) {
      throw new BadRequestException(
        `A step of ${step} needs more than the ${precision} decimal place${precision === 1 ? '' : 's'} this field keeps.`,
      );
    }

    if (step !== null && compareDecimals(step, '0') <= 0) {
      throw new BadRequestException('The step has to be greater than zero.');
    }
  }

  /**
   * Requires a percentage Field to stay within nought and a hundred.
   *
   * @param configuration - The percentage configuration.
   * @throws BadRequestException when a bound falls outside that range.
   */
  private assertPercentage(configuration: Record<string, unknown>): void {
    this.assertDecimal(configuration);

    const minimum =
      (configuration.minimum as string | null) ?? PERCENTAGE_MINIMUM;
    const maximum =
      (configuration.maximum as string | null) ?? PERCENTAGE_MAXIMUM;

    if (
      compareDecimals(minimum, PERCENTAGE_MINIMUM) < 0 ||
      compareDecimals(maximum, PERCENTAGE_MAXIMUM) > 0
    ) {
      throw new BadRequestException(
        'A percentage has to stay between 0 and 100.',
      );
    }
  }

  /**
   * Requires a slider to have somewhere for its handle to go.
   *
   * @param configuration - The slider configuration.
   * @throws BadRequestException when the ends are the wrong way round or the
   *   step is larger than the whole range.
   */
  private assertRange(configuration: Record<string, unknown>): void {
    const minimum = configuration.minimum as number;
    const maximum = configuration.maximum as number;
    const step = configuration.step as number;

    if (minimum >= maximum) {
      throw new BadRequestException(
        'A slider needs its left-hand end to be below its right-hand end.',
      );
    }

    if (step > maximum - minimum) {
      throw new BadRequestException(
        'The step cannot be larger than the whole range.',
      );
    }
  }

  /**
   * Requires a date Field's bounds not to cross.
   *
   * @param configuration - The date configuration.
   * @throws BadRequestException when the earliest date is after the latest.
   */
  private assertDateBounds(configuration: Record<string, unknown>): void {
    const minimumDate = configuration.minimumDate as string | null;
    const maximumDate = configuration.maximumDate as string | null;

    if (
      minimumDate !== null &&
      maximumDate !== null &&
      compareCalendarDates(minimumDate, maximumDate) > 0
    ) {
      throw new BadRequestException(
        'The earliest date allowed cannot be after the latest.',
      );
    }
  }

  /**
   * Requires a year Field's bounds not to cross.
   *
   * @param configuration - The year configuration.
   * @throws BadRequestException when the earliest year is after the latest.
   */
  private assertYearBounds(configuration: Record<string, unknown>): void {
    const minimumYear = configuration.minimumYear as number | null;
    const maximumYear = configuration.maximumYear as number | null;

    if (
      minimumYear !== null &&
      maximumYear !== null &&
      minimumYear > maximumYear
    ) {
      throw new BadRequestException(
        'The earliest year allowed cannot be after the latest.',
      );
    }
  }

  /**
   * Requires a duration to ask for at least one unit.
   *
   * @param configuration - The duration configuration.
   * @throws BadRequestException when every unit is switched off.
   */
  private assertDuration(configuration: Record<string, unknown>): void {
    const units = [
      configuration.includeDays,
      configuration.includeHours,
      configuration.includeMinutes,
      configuration.includeSeconds,
    ];

    if (!units.some(Boolean)) {
      throw new BadRequestException(
        'A duration has to be measured in at least one unit.',
      );
    }
  }

  /**
   * Requires a multiple-answer Field's selection bounds not to cross.
   *
   * @param configuration - The multiple-choice configuration.
   * @throws BadRequestException when the fewest exceeds the most.
   */
  private assertSelectionBounds(configuration: Record<string, unknown>): void {
    const minimumSelections = configuration.minimumSelections as number | null;
    const maximumSelections = configuration.maximumSelections as number | null;

    if (
      minimumSelections !== null &&
      maximumSelections !== null &&
      minimumSelections > maximumSelections
    ) {
      throw new BadRequestException(
        'The fewest answers required cannot be more than the most allowed.',
      );
    }
  }

  /**
   * Rewrites a checked configuration into its canonical form.
   *
   * Two definitions that mean the same thing are then stored the same way, so
   * a value checked against one is checked against the other identically.
   *
   * @param fieldType - The type being configured.
   * @param configuration - The checked configuration.
   * @returns The configuration, normalised.
   */
  private normalise(
    fieldType: CustomTrackingFieldType,
    configuration: Record<string, unknown>,
  ): Record<string, unknown> {
    const normalised: Record<string, unknown> = { ...configuration };

    for (const key of ['minimum', 'maximum', 'step']) {
      const value = normalised[key];

      if (typeof value === 'string') {
        normalised[key] = canonicaliseDecimal(value);
      }
    }

    if (typeof normalised.defaultTimezone === 'string') {
      normalised.defaultTimezone = canonicaliseTimezone(
        normalised.defaultTimezone,
      );
    }

    if (fieldType === CustomTrackingFieldType.PERCENTAGE) {
      normalised.minimum = normalised.minimum ?? PERCENTAGE_MINIMUM;
      normalised.maximum = normalised.maximum ?? PERCENTAGE_MAXIMUM;
    }

    return normalised;
  }
}
