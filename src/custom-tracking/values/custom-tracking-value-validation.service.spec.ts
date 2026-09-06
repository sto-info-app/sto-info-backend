import { BadRequestException } from '@nestjs/common';

import { YouTubeUrlService } from 'src/storytime/content/youtube-url.service';

import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingDateFormat } from '../enums/custom-tracking-date-format.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingTimeFormat } from '../enums/custom-tracking-time-format.enum';
import { CustomTrackingTriState } from '../enums/custom-tracking-tri-state.enum';
import {
  CustomTrackingValidatedValue,
  CustomTrackingValueValidationService,
} from './custom-tracking-value-validation.service';

describe('CustomTrackingValueValidationService', () => {
  let service: CustomTrackingValueValidationService;

  beforeEach(() => {
    service = new CustomTrackingValueValidationService(new YouTubeUrlService());
  });

  const field = (
    fieldType: CustomTrackingFieldType,
    configuration: Record<string, unknown> = {},
  ): CustomTrackingFieldEntity =>
    ({
      id: 'field-1',
      name: 'That field',
      fieldType,
      configuration,
    }) as unknown as CustomTrackingFieldEntity;

  const option = (
    id: string,
    label: string,
    deletedAt: Date | null = null,
  ): CustomTrackingOptionEntity =>
    ({ id, label, deletedAt }) as CustomTrackingOptionEntity;

  const check = (
    fieldType: CustomTrackingFieldType,
    configuration: Record<string, unknown>,
    submitted: unknown,
    options: CustomTrackingOptionEntity[] = [],
    previouslyChosenOptionIds: string[] = [],
  ): CustomTrackingValidatedValue | null =>
    service.validate({
      field: field(fieldType, configuration),
      options,
      previouslyChosenOptionIds,
      submitted,
    });

  describe('absence', () => {
    // Absence has to stay distinct from false, from zero, from an empty
    // selection and from an empty string, because each of those is something
    // a user may have chosen deliberately.
    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('treats %s as the answer being cleared', (_description, submitted) => {
      expect(
        check(CustomTrackingFieldType.TEXT_SINGLE_LINE, {}, submitted),
      ).toBeNull();
    });

    it('keeps an answer of false, which is not an absence', () => {
      expect(
        check(CustomTrackingFieldType.TOGGLE, {}, { boolean: false }),
      ).toEqual({ fragment: { boolean: false }, optionIds: [] });
    });

    it('keeps an answer of zero, which is not an absence', () => {
      expect(
        check(CustomTrackingFieldType.INTEGER, {}, { integer: 0 }),
      ).toEqual({ fragment: { integer: 0 }, optionIds: [] });
    });

    it.each([
      ['a string', 'plain text'],
      ['a number', 7],
      ['an array', []],
    ])('refuses %s where an object is expected', (_description, submitted) => {
      expect(() =>
        check(CustomTrackingFieldType.TEXT_SINGLE_LINE, {}, submitted),
      ).toThrow('was not sent in the expected form');
    });
  });

  describe('single-line text', () => {
    const configuration = { minLength: null, maxLength: null, pattern: null };

    it('accepts and trims a line of text', () => {
      expect(
        check(CustomTrackingFieldType.TEXT_SINGLE_LINE, configuration, {
          text: '  USS Ares  ',
        }),
      ).toEqual({ fragment: { text: 'USS Ares' }, optionIds: [] });
    });

    // Storing an empty string would make a Field look answered while showing
    // nothing, which is the ambiguity absence exists to avoid.
    it('treats an empty string as the answer being cleared', () => {
      expect(
        check(CustomTrackingFieldType.TEXT_SINGLE_LINE, configuration, {
          text: '   ',
        }),
      ).toEqual({ fragment: null, optionIds: [] });
    });

    it('applies the type ceiling when the field sets none', () => {
      expect(() =>
        check(CustomTrackingFieldType.TEXT_SINGLE_LINE, configuration, {
          text: 'x'.repeat(501),
        }),
      ).toThrow('at most 500 characters');
    });

    it('applies the field ceiling when it sets one', () => {
      expect(() =>
        check(
          CustomTrackingFieldType.TEXT_SINGLE_LINE,
          { ...configuration, maxLength: 5 },
          { text: 'far too long' },
        ),
      ).toThrow('at most 5 characters');
    });

    it('applies a minimum length', () => {
      expect(() =>
        check(
          CustomTrackingFieldType.TEXT_SINGLE_LINE,
          { ...configuration, minLength: 5 },
          { text: 'abc' },
        ),
      ).toThrow('at least 5 characters');
    });

    it('applies a pattern', () => {
      const patterned = { ...configuration, pattern: '^[A-Z]{2}-\\d{4}$' };

      expect(
        check(CustomTrackingFieldType.TEXT_SINGLE_LINE, patterned, {
          text: 'NX-0001',
        }),
      ).toEqual({ fragment: { text: 'NX-0001' }, optionIds: [] });
      expect(() =>
        check(CustomTrackingFieldType.TEXT_SINGLE_LINE, patterned, {
          text: 'nope',
        }),
      ).toThrow('not in the expected format');
    });

    it('refuses a value that is not text', () => {
      expect(() =>
        check(CustomTrackingFieldType.TEXT_SINGLE_LINE, configuration, {
          text: 7,
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('markdown', () => {
    it('keeps the source as written', () => {
      expect(
        check(
          CustomTrackingFieldType.MARKDOWN,
          { maxLength: null },
          { markdown: '  **bold**  ' },
        ),
      ).toEqual({ fragment: { markdown: '**bold**' }, optionIds: [] });
    });

    it('treats empty markdown as the answer being cleared', () => {
      expect(
        check(
          CustomTrackingFieldType.MARKDOWN,
          { maxLength: null },
          { markdown: '' },
        ),
      ).toEqual({ fragment: null, optionIds: [] });
    });

    it('applies the type ceiling when the field sets none', () => {
      expect(() =>
        check(
          CustomTrackingFieldType.MARKDOWN,
          { maxLength: null },
          { markdown: 'x'.repeat(10_001) },
        ),
      ).toThrow('at most 10000 characters');
    });

    it('applies the field ceiling when it sets one', () => {
      expect(() =>
        check(
          CustomTrackingFieldType.MARKDOWN,
          { maxLength: 10 },
          { markdown: 'x'.repeat(11) },
        ),
      ).toThrow('at most 10 characters');
    });
  });

  describe('whole numbers', () => {
    const configuration = { minimum: null, maximum: null, step: null };

    it('accepts a whole number', () => {
      expect(
        check(CustomTrackingFieldType.INTEGER, configuration, { integer: 42 }),
      ).toEqual({ fragment: { integer: 42 }, optionIds: [] });
    });

    it('refuses a fractional number', () => {
      expect(() =>
        check(CustomTrackingFieldType.INTEGER, configuration, { integer: 1.5 }),
      ).toThrow('has to be a whole number');
    });

    // Left to a later comparison, these make every bound check pass silently.
    it.each([
      ['not a number', Number.NaN],
      ['infinity', Number.POSITIVE_INFINITY],
      ['text', '42'],
    ])('refuses %s', (_description, integer) => {
      expect(() =>
        check(CustomTrackingFieldType.INTEGER, configuration, { integer }),
      ).toThrow('was not sent in the expected form');
    });

    it('applies bounds', () => {
      const bounded = { minimum: 0, maximum: 10, step: null };

      expect(() =>
        check(CustomTrackingFieldType.INTEGER, bounded, { integer: -1 }),
      ).toThrow('cannot be below 0');
      expect(() =>
        check(CustomTrackingFieldType.INTEGER, bounded, { integer: 11 }),
      ).toThrow('cannot be above 10');
    });

    // Counted from the minimum, so a field stepping by five from three accepts
    // three, eight and thirteen rather than five and ten.
    it('applies a step counted from the minimum', () => {
      const stepped = { minimum: 3, maximum: 100, step: 5 };

      expect(
        check(CustomTrackingFieldType.INTEGER, stepped, { integer: 8 }),
      ).toEqual({ fragment: { integer: 8 }, optionIds: [] });
      expect(() =>
        check(CustomTrackingFieldType.INTEGER, stepped, { integer: 10 }),
      ).toThrow('goes up in steps of 5');
    });

    it('counts a step from zero when there is no minimum', () => {
      const stepped = { minimum: null, maximum: null, step: 5 };

      expect(
        check(CustomTrackingFieldType.INTEGER, stepped, { integer: 10 }),
      ).toEqual({ fragment: { integer: 10 }, optionIds: [] });
    });
  });

  describe('decimals', () => {
    const configuration = {
      minimum: null,
      maximum: null,
      precision: 2,
      step: null,
    };

    it('accepts an exact decimal and stores it canonically', () => {
      expect(
        check(CustomTrackingFieldType.DECIMAL, configuration, {
          decimal: '007.50',
        }),
      ).toEqual({ fragment: { decimal: '7.5' }, optionIds: [] });
    });

    // A decimal that passes through a JSON number has already been rounded by
    // the time anything can check it.
    it('refuses a decimal sent as a number', () => {
      expect(() =>
        check(CustomTrackingFieldType.DECIMAL, configuration, { decimal: 7.5 }),
      ).toThrow('was not sent in the expected form');
    });

    it('refuses something that is not a decimal', () => {
      expect(() =>
        check(CustomTrackingFieldType.DECIMAL, configuration, {
          decimal: '1e3',
        }),
      ).toThrow('written out in full');
    });

    it('treats an empty decimal as the answer being cleared', () => {
      expect(
        check(CustomTrackingFieldType.DECIMAL, configuration, { decimal: '' }),
      ).toEqual({ fragment: null, optionIds: [] });
    });

    it('refuses more decimal places than the field keeps', () => {
      expect(() =>
        check(CustomTrackingFieldType.DECIMAL, configuration, {
          decimal: '1.234',
        }),
      ).toThrow('keeps 2 decimal places');
    });

    it('says "place" rather than "places" for a single one', () => {
      expect(() =>
        check(
          CustomTrackingFieldType.DECIMAL,
          { ...configuration, precision: 1 },
          { decimal: '1.23' },
        ),
      ).toThrow('keeps 1 decimal place.');
    });

    it('applies bounds exactly', () => {
      const bounded = {
        minimum: '0.10',
        maximum: '0.90',
        precision: 2,
        step: null,
      };

      expect(() =>
        check(CustomTrackingFieldType.DECIMAL, bounded, { decimal: '0.09' }),
      ).toThrow('cannot be below 0.1');
      expect(() =>
        check(CustomTrackingFieldType.DECIMAL, bounded, { decimal: '0.91' }),
      ).toThrow('cannot be above 0.9');
      expect(
        check(CustomTrackingFieldType.DECIMAL, bounded, { decimal: '0.90' }),
      ).toEqual({ fragment: { decimal: '0.9' }, optionIds: [] });
    });

    it('checks a percentage the same way', () => {
      expect(
        check(
          CustomTrackingFieldType.PERCENTAGE,
          { minimum: '0', maximum: '100', precision: 0, step: null },
          { decimal: '55' },
        ),
      ).toEqual({ fragment: { decimal: '55' }, optionIds: [] });
    });
  });

  describe('sliders', () => {
    const configuration = { minimum: 0, maximum: 10, step: 1 };

    it('accepts a value on the scale', () => {
      expect(
        check(CustomTrackingFieldType.RANGE, configuration, { number: 5 }),
      ).toEqual({ fragment: { number: 5 }, optionIds: [] });
    });

    it('refuses a value off either end', () => {
      expect(() =>
        check(CustomTrackingFieldType.RANGE, configuration, { number: -1 }),
      ).toThrow('between 0 and 10');
      expect(() =>
        check(CustomTrackingFieldType.RANGE, configuration, { number: 11 }),
      ).toThrow('between 0 and 10');
    });

    // A remainder of a fractional step lands on a floating-point residue that
    // is never exactly zero, so the step check compares against a rounded
    // multiple instead.
    it('accepts a fractional step without floating-point trouble', () => {
      const fractional = { minimum: 0, maximum: 1, step: 0.1 };

      expect(
        check(CustomTrackingFieldType.RANGE, fractional, { number: 0.3 }),
      ).toEqual({ fragment: { number: 0.3 }, optionIds: [] });
      expect(() =>
        check(CustomTrackingFieldType.RANGE, fractional, { number: 0.35 }),
      ).toThrow('goes up in steps of 0.1');
    });
  });

  describe('ratings', () => {
    it('accepts a score within the scale', () => {
      expect(
        check(CustomTrackingFieldType.RATING, { maximum: 5 }, { rating: 4 }),
      ).toEqual({ fragment: { rating: 4 }, optionIds: [] });
    });

    it.each([0, -1, 6, 2.5])('refuses a score of %s out of five', rating => {
      expect(() =>
        check(CustomTrackingFieldType.RATING, { maximum: 5 }, { rating }),
      ).toThrow('between 1 and 5');
    });
  });

  describe('progress', () => {
    const configuration = { minimum: null, maximum: null };

    it('stores both the figure and its total', () => {
      expect(
        check(CustomTrackingFieldType.PROGRESS, configuration, {
          current: 3,
          maximum: 10,
        }),
      ).toEqual({ fragment: { current: 3, maximum: 10 }, optionIds: [] });
    });

    it('refuses being further along than the total', () => {
      expect(() =>
        check(CustomTrackingFieldType.PROGRESS, configuration, {
          current: 11,
          maximum: 10,
        }),
      ).toThrow('further along than its total');
    });

    it('refuses a total of nothing', () => {
      expect(() =>
        check(CustomTrackingFieldType.PROGRESS, configuration, {
          current: 0,
          maximum: 0,
        }),
      ).toThrow('total greater than zero');
    });

    it('applies the configured bounds', () => {
      expect(() =>
        check(
          CustomTrackingFieldType.PROGRESS,
          { minimum: 5, maximum: null },
          { current: 1, maximum: 10 },
        ),
      ).toThrow('cannot be below 5');
      expect(() =>
        check(
          CustomTrackingFieldType.PROGRESS,
          { minimum: null, maximum: 10 },
          { current: 1, maximum: 20 },
        ),
      ).toThrow('total above 10');
    });
  });

  describe('dates', () => {
    const configuration = {
      minimumDate: null,
      maximumDate: null,
      dateFormat: CustomTrackingDateFormat.LONG,
    };

    it('accepts a calendar date', () => {
      expect(
        check(CustomTrackingFieldType.DATE, configuration, {
          date: '2026-09-04',
        }),
      ).toEqual({ fragment: { date: '2026-09-04' }, optionIds: [] });
    });

    it('treats an empty date as the answer being cleared', () => {
      expect(
        check(CustomTrackingFieldType.DATE, configuration, { date: '' }),
      ).toEqual({ fragment: null, optionIds: [] });
    });

    it('refuses a day that does not exist', () => {
      expect(() =>
        check(CustomTrackingFieldType.DATE, configuration, {
          date: '2026-02-30',
        }),
      ).toThrow('a date that exists');
    });

    it('applies bounds', () => {
      const bounded = {
        ...configuration,
        minimumDate: '2020-01-01',
        maximumDate: '2030-12-31',
      };

      expect(() =>
        check(CustomTrackingFieldType.DATE, bounded, { date: '2019-12-31' }),
      ).toThrow('cannot be before 2020-01-01');
      expect(() =>
        check(CustomTrackingFieldType.DATE, bounded, { date: '2031-01-01' }),
      ).toThrow('cannot be after 2030-12-31');
    });
  });

  describe('times', () => {
    const configuration = {
      defaultTimezone: 'Europe/London',
      timeFormat: CustomTrackingTimeFormat.TWENTY_FOUR_HOUR,
    };

    // A time without a date is not an instant, so converting it would be a
    // guess, and the guess would be wrong twice a year.
    it('keeps a wall-clock time and its zone, unconverted', () => {
      expect(
        check(CustomTrackingFieldType.TIME, configuration, { time: '14:30' }),
      ).toEqual({
        fragment: { time: '14:30', timezone: 'Europe/London' },
        optionIds: [],
      });
    });

    it('lets a value override the field’s default zone', () => {
      expect(
        check(CustomTrackingFieldType.TIME, configuration, {
          time: '14:30',
          timezone: 'america/new_york',
        }),
      ).toMatchObject({ fragment: { timezone: 'America/New_York' } });
    });

    it('treats an empty time as the answer being cleared', () => {
      expect(
        check(CustomTrackingFieldType.TIME, configuration, { time: '' }),
      ).toEqual({ fragment: null, optionIds: [] });
    });

    it('refuses a time that does not exist', () => {
      expect(() =>
        check(CustomTrackingFieldType.TIME, configuration, { time: '25:00' }),
      ).toThrow('written as HH:mm');
    });

    it('refuses a timezone that is not text', () => {
      expect(() =>
        check(CustomTrackingFieldType.TIME, configuration, {
          time: '14:30',
          timezone: 7,
        }),
      ).toThrow('IANA timezone');
    });

    it('refuses an abbreviation as a timezone', () => {
      expect(() =>
        check(CustomTrackingFieldType.TIME, configuration, {
          time: '14:30',
          timezone: 'BST',
        }),
      ).toThrow('IANA timezone');
    });
  });

  describe('dates and times', () => {
    const configuration = {
      defaultTimezone: 'Europe/London',
      dateFormat: CustomTrackingDateFormat.LONG,
      timeFormat: CustomTrackingTimeFormat.TWENTY_FOUR_HOUR,
    };

    it('converts to UTC and keeps the zone it was entered in', () => {
      expect(
        check(CustomTrackingFieldType.DATE_TIME, configuration, {
          localDateTime: '2026-07-15T12:00',
        }),
      ).toEqual({
        fragment: {
          instant: '2026-07-15T11:00:00.000Z',
          timezone: 'Europe/London',
        },
        optionIds: [],
      });
    });

    it('uses the winter offset for a winter date', () => {
      expect(
        check(CustomTrackingFieldType.DATE_TIME, configuration, {
          localDateTime: '2026-01-15T12:00',
        }),
      ).toMatchObject({ fragment: { instant: '2026-01-15T12:00:00.000Z' } });
    });

    // On the morning the clocks go forward there is no half past one.
    it('refuses a local time inside a spring-forward gap', () => {
      expect(() =>
        check(CustomTrackingFieldType.DATE_TIME, configuration, {
          localDateTime: '2026-03-29T01:30',
        }),
      ).toThrow('Clocks may have gone forward');
    });

    it('treats an empty moment as the answer being cleared', () => {
      expect(
        check(CustomTrackingFieldType.DATE_TIME, configuration, {
          localDateTime: '',
        }),
      ).toEqual({ fragment: null, optionIds: [] });
    });
  });

  describe('months, years and durations', () => {
    it('accepts a month within a year', () => {
      expect(
        check(CustomTrackingFieldType.MONTH_YEAR, {}, { year: 2026, month: 9 }),
      ).toEqual({ fragment: { year: 2026, month: 9 }, optionIds: [] });
    });

    it.each([0, 13, 1.5])('refuses month %s', month => {
      expect(() =>
        check(CustomTrackingFieldType.MONTH_YEAR, {}, { year: 2026, month }),
      ).toThrow('month between 1 and 12');
    });

    it('refuses a year outside what is stored', () => {
      expect(() =>
        check(CustomTrackingFieldType.MONTH_YEAR, {}, { year: 0, month: 1 }),
      ).toThrow('four-digit year');
    });

    it('accepts a year and applies its bounds', () => {
      const bounded = { minimumYear: 2020, maximumYear: 2030 };

      expect(
        check(CustomTrackingFieldType.YEAR, bounded, { year: 2026 }),
      ).toEqual({ fragment: { year: 2026 }, optionIds: [] });
      expect(() =>
        check(CustomTrackingFieldType.YEAR, bounded, { year: 2019 }),
      ).toThrow('cannot be before 2020');
      expect(() =>
        check(CustomTrackingFieldType.YEAR, bounded, { year: 2031 }),
      ).toThrow('cannot be after 2030');
    });

    it('refuses a year outside what is stored at all', () => {
      expect(() =>
        check(
          CustomTrackingFieldType.YEAR,
          { minimumYear: null, maximumYear: null },
          { year: 10_000 },
        ),
      ).toThrow('four-digit year');
    });

    const durationConfiguration = {
      includeDays: true,
      includeHours: true,
      includeMinutes: false,
      includeSeconds: false,
    };

    it('accepts the components the field asks for', () => {
      expect(
        check(CustomTrackingFieldType.DURATION, durationConfiguration, {
          days: 2,
          hours: 4,
        }),
      ).toEqual({
        fragment: { days: 2, hours: 4, minutes: 0, seconds: 0 },
        optionIds: [],
      });
    });

    // A value in a unit the Field does not ask for would be stored and never
    // shown back.
    it('refuses a component the field does not ask for', () => {
      expect(() =>
        check(CustomTrackingFieldType.DURATION, durationConfiguration, {
          days: 2,
          minutes: 30,
        }),
      ).toThrow('not measured in minutes');
    });

    it('accepts a zero in a unit the field does not ask for', () => {
      expect(
        check(CustomTrackingFieldType.DURATION, durationConfiguration, {
          days: 2,
          minutes: 0,
        }),
      ).toMatchObject({ fragment: { days: 2 } });
    });

    it.each([-1, 1.5, 'two'])('refuses a component of %s', days => {
      expect(() =>
        check(CustomTrackingFieldType.DURATION, durationConfiguration, {
          days,
        }),
      ).toThrow('whole numbers of days');
    });

    it('refuses an absurd component', () => {
      expect(() =>
        check(CustomTrackingFieldType.DURATION, durationConfiguration, {
          days: 100_001,
        }),
      ).toThrow('cannot hold that many days');
    });
  });

  describe('ranges of dates and times', () => {
    const dateConfiguration = {
      minimumDate: null,
      maximumDate: null,
      dateFormat: CustomTrackingDateFormat.LONG,
    };

    it('accepts a start and end date', () => {
      expect(
        check(CustomTrackingFieldType.DATE_RANGE, dateConfiguration, {
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      ).toEqual({
        fragment: { startDate: '2026-01-01', endDate: '2026-12-31' },
        optionIds: [],
      });
    });

    it('accepts a range that starts and ends on the same day', () => {
      expect(
        check(CustomTrackingFieldType.DATE_RANGE, dateConfiguration, {
          startDate: '2026-01-01',
          endDate: '2026-01-01',
        }),
      ).toBeTruthy();
    });

    it('refuses a range that ends before it starts', () => {
      expect(() =>
        check(CustomTrackingFieldType.DATE_RANGE, dateConfiguration, {
          startDate: '2026-12-31',
          endDate: '2026-01-01',
        }),
      ).toThrow('cannot end before it starts');
    });

    it('applies date bounds to both ends', () => {
      const bounded = { ...dateConfiguration, minimumDate: '2026-01-01' };

      expect(() =>
        check(CustomTrackingFieldType.DATE_RANGE, bounded, {
          startDate: '2025-12-31',
          endDate: '2026-06-01',
        }),
      ).toThrow('cannot be before 2026-01-01');
    });

    const dateTimeConfiguration = {
      defaultTimezone: 'Europe/London',
      dateFormat: CustomTrackingDateFormat.LONG,
      timeFormat: CustomTrackingTimeFormat.TWENTY_FOUR_HOUR,
    };

    it('converts both ends and keeps one zone', () => {
      expect(
        check(CustomTrackingFieldType.DATE_TIME_RANGE, dateTimeConfiguration, {
          startLocalDateTime: '2026-07-15T12:00',
          endLocalDateTime: '2026-07-15T14:00',
        }),
      ).toEqual({
        fragment: {
          startInstant: '2026-07-15T11:00:00.000Z',
          endInstant: '2026-07-15T13:00:00.000Z',
          timezone: 'Europe/London',
        },
        optionIds: [],
      });
    });

    it('refuses a span that ends before it starts', () => {
      expect(() =>
        check(CustomTrackingFieldType.DATE_TIME_RANGE, dateTimeConfiguration, {
          startLocalDateTime: '2026-07-15T14:00',
          endLocalDateTime: '2026-07-15T12:00',
        }),
      ).toThrow('cannot end before it starts');
    });
  });

  describe('yes and no answers', () => {
    it.each([CustomTrackingFieldType.TOGGLE, CustomTrackingFieldType.CHECKBOX])(
      'accepts either answer for %s',
      fieldType => {
        expect(check(fieldType, {}, { boolean: true })).toEqual({
          fragment: { boolean: true },
          optionIds: [],
        });
      },
    );

    it('refuses something that is not a yes or a no', () => {
      expect(() =>
        check(CustomTrackingFieldType.TOGGLE, {}, { boolean: 'yes' }),
      ).toThrow('has to be yes or no');
    });

    it.each(Object.values(CustomTrackingTriState))(
      'accepts %s for a three-way answer',
      triState => {
        expect(
          check(CustomTrackingFieldType.YES_NO_UNKNOWN, {}, { triState }),
        ).toEqual({ fragment: { triState }, optionIds: [] });
      },
    );

    it('refuses an unrecognised three-way answer', () => {
      expect(() =>
        check(
          CustomTrackingFieldType.YES_NO_UNKNOWN,
          {},
          { triState: 'MAYBE' },
        ),
      ).toThrow('yes, no or unknown');
      expect(() =>
        check(CustomTrackingFieldType.YES_NO_UNKNOWN, {}, { triState: 7 }),
      ).toThrow('yes, no or unknown');
    });
  });

  describe('colours', () => {
    it('accepts one of the site’s own colours by name', () => {
      expect(
        check(CustomTrackingFieldType.COLOUR, {}, { token: 'LCARS_SUNFLOWER' }),
      ).toEqual({
        fragment: { token: 'LCARS_SUNFLOWER', literal: null },
        optionIds: [],
      });
    });

    it('refuses a colour name the palette does not have', () => {
      expect(() =>
        check(CustomTrackingFieldType.COLOUR, {}, { token: 'LCARS_MADE_UP' }),
      ).toThrow('does not recognise that colour name');
    });

    it('refuses a name that is not text', () => {
      expect(() =>
        check(CustomTrackingFieldType.COLOUR, {}, { token: 7 }),
      ).toThrow('does not recognise that colour name');
    });

    it('expands a short hexadecimal colour', () => {
      expect(
        check(CustomTrackingFieldType.COLOUR, {}, { literal: '#FC6' }),
      ).toEqual({
        fragment: { token: null, literal: '#ffcc66' },
        optionIds: [],
      });
    });

    it('accepts a full hexadecimal colour', () => {
      expect(
        check(CustomTrackingFieldType.COLOUR, {}, { literal: '#FFCC66' }),
      ).toMatchObject({ fragment: { literal: '#ffcc66' } });
    });

    it('accepts a colour with transparency', () => {
      expect(
        check(
          CustomTrackingFieldType.COLOUR,
          {},
          { literal: 'rgba(255, 204, 102, 0.5)' },
        ),
      ).toMatchObject({ fragment: { literal: 'rgba(255, 204, 102, 0.5)' } });
    });

    it('refuses a component beyond what a colour holds', () => {
      expect(() =>
        check(CustomTrackingFieldType.COLOUR, {}, { literal: 'rgb(300,0,0)' }),
      ).toThrow('#RRGGBB or rgba');
    });

    it.each([
      ['neither a name nor a colour', {}],
      [
        'both a name and a colour',
        { token: 'LCARS_SUNFLOWER', literal: '#fc6' },
      ],
    ])('refuses %s', (_description, submitted) => {
      expect(() =>
        check(CustomTrackingFieldType.COLOUR, {}, submitted),
      ).toThrow('not both');
    });

    it.each([
      ['not a colour at all', 'chartreuse'],
      ['a number', 7],
    ])('refuses %s', (_description, literal) => {
      expect(() =>
        check(CustomTrackingFieldType.COLOUR, {}, { literal }),
      ).toThrow('#RRGGBB or rgba');
    });
  });

  describe('answers chosen from a list', () => {
    const options = [
      option('option-1', 'Escort'),
      option('option-2', 'Cruiser'),
      option('option-3', 'Retired', new Date('2026-01-01T00:00:00Z')),
    ];

    it('accepts one answer', () => {
      expect(
        check(
          CustomTrackingFieldType.DROPDOWN,
          {},
          { optionIds: ['option-1'] },
          options,
        ),
      ).toEqual({ fragment: null, optionIds: ['option-1'] });
    });

    it('treats no selection as the answer being cleared', () => {
      expect(
        check(CustomTrackingFieldType.DROPDOWN, {}, { optionIds: [] }, options),
      ).toEqual({ fragment: null, optionIds: [] });
    });

    it('refuses two answers where one is asked for', () => {
      expect(() =>
        check(
          CustomTrackingFieldType.RADIO,
          {},
          { optionIds: ['option-1', 'option-2'] },
          options,
        ),
      ).toThrow('takes one answer');
    });

    it('refuses an answer this field does not offer', () => {
      expect(() =>
        check(
          CustomTrackingFieldType.DROPDOWN,
          {},
          { optionIds: ['somebody-elses-option'] },
          options,
        ),
      ).toThrow('does not offer one of those answers');
    });

    // A withdrawn option is allowed only where it was already chosen. That is
    // what lets a user keep an answer they gave before it was withdrawn.
    it('refuses a withdrawn option nobody had chosen', () => {
      expect(() =>
        check(
          CustomTrackingFieldType.DROPDOWN,
          {},
          { optionIds: ['option-3'] },
          options,
        ),
      ).toThrow('no longer offered');
    });

    it('keeps a withdrawn option that was already chosen', () => {
      expect(
        check(
          CustomTrackingFieldType.DROPDOWN,
          {},
          { optionIds: ['option-3'] },
          options,
          ['option-3'],
        ),
      ).toEqual({ fragment: null, optionIds: ['option-3'] });
    });

    it.each([
      ['something that is not a list', { optionIds: 'option-1' }],
      ['a list of things that are not identifiers', { optionIds: [7] }],
    ])('refuses %s', (_description, submitted) => {
      expect(() =>
        check(CustomTrackingFieldType.DROPDOWN, {}, submitted, options),
      ).toThrow('was not sent in the expected form');
    });

    it('treats an empty multiple selection as the answer being cleared', () => {
      expect(
        check(
          CustomTrackingFieldType.MULTI_SELECT,
          { minimumSelections: null, maximumSelections: null },
          { optionIds: [] },
          options,
        ),
      ).toEqual({ fragment: null, optionIds: [] });
    });

    it('de-duplicates a repeated selection', () => {
      expect(
        check(
          CustomTrackingFieldType.MULTI_SELECT,
          { minimumSelections: null, maximumSelections: null },
          { optionIds: ['option-1', 'option-1'] },
          options,
        ),
      ).toEqual({ fragment: null, optionIds: ['option-1'] });
    });

    it('applies selection bounds', () => {
      const bounded = { minimumSelections: 2, maximumSelections: 2 };

      expect(() =>
        check(
          CustomTrackingFieldType.CHECKBOX_LIST,
          bounded,
          { optionIds: ['option-1'] },
          options,
        ),
      ).toThrow('at least 2 answers');
      expect(() =>
        check(
          CustomTrackingFieldType.CHECKBOX_LIST,
          { minimumSelections: null, maximumSelections: 1 },
          { optionIds: ['option-1', 'option-2'] },
          options,
        ),
      ).toThrow('at most 1 answers');
    });

    it('applies the type ceiling to tags', () => {
      const many = Array.from({ length: 51 }, (_, index) =>
        option(`option-${index}`, `Tag ${index}`),
      );

      expect(() =>
        check(
          CustomTrackingFieldType.TAGS,
          { minimumSelections: null, maximumSelections: null },
          { optionIds: many.map(tag => tag.id) },
          many,
        ),
      ).toThrow('at most 50 answers');
    });
  });

  describe('YouTube videos', () => {
    it('stores only what the parser produced', () => {
      expect(
        check(
          CustomTrackingFieldType.YOUTUBE,
          {},
          { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30' },
        ),
      ).toEqual({
        fragment: { videoId: 'dQw4w9WgXcQ', startSeconds: 30 },
        optionIds: [],
      });
    });

    it('treats an empty link as the answer being cleared', () => {
      expect(check(CustomTrackingFieldType.YOUTUBE, {}, { url: '' })).toEqual({
        fragment: null,
        optionIds: [],
      });
    });

    // The site's own parser decides, so a host that merely contains a YouTube
    // domain is refused exactly as it is in Storytime.
    it.each([
      ['a lookalike host', 'https://youtu.be.attacker.example/dQw4w9WgXcQ'],
      ['a script URL', 'javascript:alert(1)'],
      ['embed markup', '<iframe src="https://youtube.com/embed/x"></iframe>'],
      ['a channel', 'https://www.youtube.com/@somebody'],
      ['nonsense', 'not a url'],
    ])('refuses %s', (_description, url) => {
      expect(() => check(CustomTrackingFieldType.YOUTUBE, {}, { url })).toThrow(
        'needs a link to a YouTube video',
      );
    });
  });

  describe('pictures', () => {
    // Accepting an identifier in a value payload would let a caller point a
    // Field at any image in the account.
    it('refuses a picture set through the ordinary value route', () => {
      expect(() =>
        check(
          CustomTrackingFieldType.IMAGE,
          { shape: 'SQUARE' },
          { cloudflareImageId: 'someone-elses-image' },
        ),
      ).toThrow('set by uploading them');
    });
  });
});
