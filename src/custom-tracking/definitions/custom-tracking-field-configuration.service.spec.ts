import { BadRequestException } from '@nestjs/common';

import { CustomTrackingDateFormat } from '../enums/custom-tracking-date-format.enum';
import { CustomTrackingDurationFormat } from '../enums/custom-tracking-duration-format.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';
import { CustomTrackingMonthYearFormat } from '../enums/custom-tracking-month-year-format.enum';
import { CustomTrackingTimeFormat } from '../enums/custom-tracking-time-format.enum';
import { CustomTrackingFieldConfigurationService } from './custom-tracking-field-configuration.service';

describe('CustomTrackingFieldConfigurationService', () => {
  let service: CustomTrackingFieldConfigurationService;

  beforeEach(() => {
    service = new CustomTrackingFieldConfigurationService();
  });

  const validate = (
    fieldType: CustomTrackingFieldType,
    configuration: unknown,
  ): Record<string, unknown> =>
    service.validate(fieldType, configuration) as unknown as Record<
      string,
      unknown
    >;

  /** A configuration each type accepts, for tests about something else. */
  const ACCEPTABLE: Record<CustomTrackingFieldType, unknown> = {
    [CustomTrackingFieldType.TEXT_SINGLE_LINE]: {},
    [CustomTrackingFieldType.MARKDOWN]: {},
    [CustomTrackingFieldType.INTEGER]: {},
    [CustomTrackingFieldType.DECIMAL]: { precision: 2 },
    [CustomTrackingFieldType.PERCENTAGE]: { precision: 2 },
    [CustomTrackingFieldType.RANGE]: { minimum: 0, maximum: 10, step: 1 },
    [CustomTrackingFieldType.RATING]: { maximum: 5 },
    [CustomTrackingFieldType.PROGRESS]: {
      showPercentage: true,
      showProgressBar: true,
    },
    [CustomTrackingFieldType.DATE]: {
      dateFormat: CustomTrackingDateFormat.LONG,
    },
    [CustomTrackingFieldType.TIME]: {
      defaultTimezone: 'Europe/London',
      timeFormat: CustomTrackingTimeFormat.TWENTY_FOUR_HOUR,
    },
    [CustomTrackingFieldType.DATE_TIME]: {
      defaultTimezone: 'Europe/London',
      dateFormat: CustomTrackingDateFormat.LONG,
      timeFormat: CustomTrackingTimeFormat.LOCALE,
    },
    [CustomTrackingFieldType.MONTH_YEAR]: {
      monthYearFormat: CustomTrackingMonthYearFormat.LONG,
    },
    [CustomTrackingFieldType.YEAR]: {},
    [CustomTrackingFieldType.DURATION]: {
      durationFormat: CustomTrackingDurationFormat.COMPACT,
      includeDays: true,
      includeHours: true,
      includeMinutes: false,
      includeSeconds: false,
    },
    [CustomTrackingFieldType.DATE_RANGE]: {
      dateFormat: CustomTrackingDateFormat.SHORT,
    },
    [CustomTrackingFieldType.DATE_TIME_RANGE]: {
      defaultTimezone: 'Europe/London',
      dateFormat: CustomTrackingDateFormat.SHORT,
      timeFormat: CustomTrackingTimeFormat.TWELVE_HOUR,
    },
    [CustomTrackingFieldType.TOGGLE]: {},
    [CustomTrackingFieldType.CHECKBOX]: {},
    [CustomTrackingFieldType.RADIO]: {},
    [CustomTrackingFieldType.DROPDOWN]: {},
    [CustomTrackingFieldType.CHECKBOX_LIST]: {},
    [CustomTrackingFieldType.MULTI_SELECT]: {},
    [CustomTrackingFieldType.YES_NO_UNKNOWN]: {},
    [CustomTrackingFieldType.COLOUR]: {},
    [CustomTrackingFieldType.TAGS]: {},
    [CustomTrackingFieldType.IMAGE]: {
      shape: CustomTrackingImageShape.SQUARE,
    },
    [CustomTrackingFieldType.YOUTUBE]: {},
  };

  describe('every type', () => {
    it.each(Object.values(CustomTrackingFieldType))(
      'accepts a usable configuration for %s',
      fieldType => {
        expect(() => validate(fieldType, ACCEPTABLE[fieldType])).not.toThrow();
      },
    );

    // The column is JSONB with no schema underneath, so a setting nobody
    // recognises has to be refused rather than quietly stored.
    it.each(Object.values(CustomTrackingFieldType))(
      'refuses an unrecognised setting on %s',
      fieldType => {
        expect(() =>
          validate(fieldType, {
            ...(ACCEPTABLE[fieldType] as object),
            somethingElse: 'nonsense',
          }),
        ).toThrow(BadRequestException);
      },
    );
  });

  describe('shape', () => {
    it.each([
      ['null', null],
      ['an array', []],
      ['a string', 'nonsense'],
      ['a number', 7],
    ])('refuses %s as a configuration', (_description, configuration) => {
      expect(() =>
        validate(CustomTrackingFieldType.TEXT_SINGLE_LINE, configuration),
      ).toThrow('Field configuration must be an object.');
    });

    it('reports what failed rather than that something did', () => {
      expect(() =>
        validate(CustomTrackingFieldType.RATING, { maximum: 4 }),
      ).toThrow(BadRequestException);
    });
  });

  describe('single-line text', () => {
    it('accepts bounds the right way round', () => {
      expect(
        validate(CustomTrackingFieldType.TEXT_SINGLE_LINE, {
          minLength: 2,
          maxLength: 20,
        }),
      ).toMatchObject({ minLength: 2, maxLength: 20 });
    });

    it('refuses bounds that cross', () => {
      expect(() =>
        validate(CustomTrackingFieldType.TEXT_SINGLE_LINE, {
          minLength: 20,
          maxLength: 2,
        }),
      ).toThrow(
        'The shortest length allowed cannot be longer than the longest.',
      );
    });

    it('accepts a bound on its own', () => {
      expect(() =>
        validate(CustomTrackingFieldType.TEXT_SINGLE_LINE, { minLength: 2 }),
      ).not.toThrow();
      expect(() =>
        validate(CustomTrackingFieldType.TEXT_SINGLE_LINE, { maxLength: 2 }),
      ).not.toThrow();
    });

    it('accepts a pattern that compiles', () => {
      expect(() =>
        validate(CustomTrackingFieldType.TEXT_SINGLE_LINE, {
          pattern: '^[A-Z]{2}-\\d{4}$',
        }),
      ).not.toThrow();
    });

    // Refused while the user is still looking at the form, rather than
    // failing every value they later try to save against it.
    it('refuses a pattern that will not compile', () => {
      expect(() =>
        validate(CustomTrackingFieldType.TEXT_SINGLE_LINE, {
          pattern: '([unclosed',
        }),
      ).toThrow('That validation pattern is not a valid regular expression.');
    });
  });

  describe('whole numbers', () => {
    it('accepts bounds the right way round', () => {
      expect(() =>
        validate(CustomTrackingFieldType.INTEGER, { minimum: 0, maximum: 10 }),
      ).not.toThrow();
    });

    it('refuses bounds that cross', () => {
      expect(() =>
        validate(CustomTrackingFieldType.INTEGER, { minimum: 10, maximum: 0 }),
      ).toThrow(
        'The smallest value allowed cannot be larger than the largest.',
      );
    });

    it('refuses a fractional bound', () => {
      expect(() =>
        validate(CustomTrackingFieldType.INTEGER, { minimum: 1.5 }),
      ).toThrow(BadRequestException);
    });
  });

  describe('decimals', () => {
    // A bound that has been through a JSON number has already been rounded,
    // and a rounded bound admits figures it was written to exclude.
    it('refuses a bound sent as a number rather than as text', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DECIMAL, {
          precision: 2,
          minimum: 1.5,
        }),
      ).toThrow(BadRequestException);
    });

    it('accepts exact decimal bounds', () => {
      expect(
        validate(CustomTrackingFieldType.DECIMAL, {
          precision: 2,
          minimum: '0.00',
          maximum: '99.50',
        }),
      ).toMatchObject({ minimum: '0', maximum: '99.5' });
    });

    it('refuses bounds that cross', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DECIMAL, {
          precision: 2,
          minimum: '10',
          maximum: '2',
        }),
      ).toThrow(
        'The smallest value allowed cannot be larger than the largest.',
      );
    });

    // Every value is rounded to the precision before it is stored, so a finer
    // step could never be landed on.
    it('refuses a step finer than the precision', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DECIMAL, {
          precision: 2,
          step: '0.001',
        }),
      ).toThrow('needs more than the 2 decimal places this field keeps');
    });

    it('says "place" rather than "places" for a single one', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DECIMAL, {
          precision: 1,
          step: '0.01',
        }),
      ).toThrow('needs more than the 1 decimal place this field keeps');
    });

    it('refuses a step of zero or less', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DECIMAL, { precision: 2, step: '0' }),
      ).toThrow('The step has to be greater than zero.');
      expect(() =>
        validate(CustomTrackingFieldType.DECIMAL, {
          precision: 2,
          step: '-1',
        }),
      ).toThrow('The step has to be greater than zero.');
    });

    it('accepts a step the precision can reach', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DECIMAL, {
          precision: 2,
          step: '0.25',
        }),
      ).not.toThrow();
    });

    it('refuses a precision beyond what is kept', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DECIMAL, { precision: 99 }),
      ).toThrow(BadRequestException);
    });
  });

  describe('percentages', () => {
    it('supplies the usual bounds when none are given', () => {
      expect(
        validate(CustomTrackingFieldType.PERCENTAGE, { precision: 0 }),
      ).toMatchObject({ minimum: '0', maximum: '100' });
    });

    it('keeps bounds inside the usual range', () => {
      expect(
        validate(CustomTrackingFieldType.PERCENTAGE, {
          precision: 0,
          minimum: '10',
          maximum: '90',
        }),
      ).toMatchObject({ minimum: '10', maximum: '90' });
    });

    it('refuses a bound below nought', () => {
      expect(() =>
        validate(CustomTrackingFieldType.PERCENTAGE, {
          precision: 0,
          minimum: '-1',
        }),
      ).toThrow('A percentage has to stay between 0 and 100.');
    });

    it('refuses a bound above a hundred', () => {
      expect(() =>
        validate(CustomTrackingFieldType.PERCENTAGE, {
          precision: 0,
          maximum: '101',
        }),
      ).toThrow('A percentage has to stay between 0 and 100.');
    });
  });

  describe('sliders', () => {
    it('refuses ends the wrong way round', () => {
      expect(() =>
        validate(CustomTrackingFieldType.RANGE, {
          minimum: 10,
          maximum: 0,
          step: 1,
        }),
      ).toThrow(
        'A slider needs its left-hand end to be below its right-hand end.',
      );
    });

    it('refuses ends that are the same', () => {
      expect(() =>
        validate(CustomTrackingFieldType.RANGE, {
          minimum: 5,
          maximum: 5,
          step: 1,
        }),
      ).toThrow(
        'A slider needs its left-hand end to be below its right-hand end.',
      );
    });

    it('refuses a step larger than the whole range', () => {
      expect(() =>
        validate(CustomTrackingFieldType.RANGE, {
          minimum: 0,
          maximum: 5,
          step: 10,
        }),
      ).toThrow('The step cannot be larger than the whole range.');
    });

    // A slider with no ends would have nothing to draw and nowhere for the
    // handle to sit.
    it('refuses a slider missing an end', () => {
      expect(() =>
        validate(CustomTrackingFieldType.RANGE, { minimum: 0, step: 1 }),
      ).toThrow(BadRequestException);
    });
  });

  describe('ratings', () => {
    it.each([3, 5, 10])('accepts a maximum of %s', maximum => {
      expect(() =>
        validate(CustomTrackingFieldType.RATING, { maximum }),
      ).not.toThrow();
    });

    // An arbitrary maximum stops being readable long before it stops being
    // expressible.
    it.each([1, 4, 7, 100])('refuses a maximum of %s', maximum => {
      expect(() =>
        validate(CustomTrackingFieldType.RATING, { maximum }),
      ).toThrow(BadRequestException);
    });
  });

  describe('progress', () => {
    it('refuses bounds that cross', () => {
      expect(() =>
        validate(CustomTrackingFieldType.PROGRESS, {
          minimum: 10,
          maximum: 0,
          showPercentage: false,
          showProgressBar: false,
        }),
      ).toThrow(
        'The smallest value allowed cannot be larger than the largest.',
      );
    });
  });

  describe('dates', () => {
    it('accepts bounds the right way round', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DATE, {
          minimumDate: '2010-01-01',
          maximumDate: '2030-12-31',
          dateFormat: CustomTrackingDateFormat.LONG,
        }),
      ).not.toThrow();
    });

    it('refuses bounds that cross', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DATE, {
          minimumDate: '2030-01-01',
          maximumDate: '2010-01-01',
          dateFormat: CustomTrackingDateFormat.LONG,
        }),
      ).toThrow('The earliest date allowed cannot be after the latest.');
    });

    // The pattern alone would accept this; only the calendar check refuses it.
    it('refuses a day that does not exist', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DATE, {
          minimumDate: '2026-02-30',
          dateFormat: CustomTrackingDateFormat.LONG,
        }),
      ).toThrow(BadRequestException);
    });

    it('applies the same bounds rule to a date range', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DATE_RANGE, {
          minimumDate: '2030-01-01',
          maximumDate: '2010-01-01',
          dateFormat: CustomTrackingDateFormat.LONG,
        }),
      ).toThrow('The earliest date allowed cannot be after the latest.');
    });
  });

  describe('times', () => {
    it('stores the timezone in the spelling the runtime uses', () => {
      expect(
        validate(CustomTrackingFieldType.TIME, {
          defaultTimezone: 'europe/london',
          timeFormat: CustomTrackingTimeFormat.LOCALE,
        }),
      ).toMatchObject({ defaultTimezone: 'Europe/London' });
    });

    // An abbreviation does not say whether summer time applies.
    it.each(['GMT', 'BST', 'nonsense'])('refuses %s as a timezone', zone => {
      expect(() =>
        validate(CustomTrackingFieldType.TIME, {
          defaultTimezone: zone,
          timeFormat: CustomTrackingTimeFormat.LOCALE,
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('years', () => {
    it('refuses bounds that cross', () => {
      expect(() =>
        validate(CustomTrackingFieldType.YEAR, {
          minimumYear: 2030,
          maximumYear: 2010,
        }),
      ).toThrow('The earliest year allowed cannot be after the latest.');
    });

    it('accepts bounds the right way round', () => {
      expect(() =>
        validate(CustomTrackingFieldType.YEAR, {
          minimumYear: 2010,
          maximumYear: 2030,
        }),
      ).not.toThrow();
    });
  });

  describe('durations', () => {
    it('refuses a duration measured in nothing', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DURATION, {
          durationFormat: CustomTrackingDurationFormat.LONG,
          includeDays: false,
          includeHours: false,
          includeMinutes: false,
          includeSeconds: false,
        }),
      ).toThrow('A duration has to be measured in at least one unit.');
    });

    it('accepts a duration measured in one unit', () => {
      expect(() =>
        validate(CustomTrackingFieldType.DURATION, {
          durationFormat: CustomTrackingDurationFormat.LONG,
          includeDays: false,
          includeHours: false,
          includeMinutes: false,
          includeSeconds: true,
        }),
      ).not.toThrow();
    });
  });

  describe('multiple answers', () => {
    it.each([
      CustomTrackingFieldType.CHECKBOX_LIST,
      CustomTrackingFieldType.MULTI_SELECT,
      CustomTrackingFieldType.TAGS,
    ])('refuses selection bounds that cross for %s', fieldType => {
      expect(() =>
        validate(fieldType, { minimumSelections: 5, maximumSelections: 2 }),
      ).toThrow(
        'The fewest answers required cannot be more than the most allowed.',
      );
    });

    it('accepts selection bounds the right way round', () => {
      expect(() =>
        validate(CustomTrackingFieldType.MULTI_SELECT, {
          minimumSelections: 1,
          maximumSelections: 3,
        }),
      ).not.toThrow();
    });
  });

  describe('images', () => {
    it.each(Object.values(CustomTrackingImageShape))(
      'accepts the %s shape',
      shape => {
        expect(() =>
          validate(CustomTrackingFieldType.IMAGE, { shape }),
        ).not.toThrow();
      },
    );

    // A shape nobody configured in Cloudflare yields a broken picture rather
    // than an error anybody would see.
    it('refuses a shape that is not one of the three', () => {
      expect(() =>
        validate(CustomTrackingFieldType.IMAGE, { shape: 'CIRCLE' }),
      ).toThrow(BadRequestException);
    });
  });
});
