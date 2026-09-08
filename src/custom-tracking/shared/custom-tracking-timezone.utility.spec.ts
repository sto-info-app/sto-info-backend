import {
  canonicaliseTimezone,
  isKnownTimezone,
  toLocalDateTime,
  toUtcInstant,
} from './custom-tracking-timezone.utility';

describe('canonicaliseTimezone', () => {
  it('accepts an identifier already in its canonical spelling', () => {
    expect(canonicaliseTimezone('Europe/London')).toBe('Europe/London');
  });

  // A user who types their timezone rather than picking it should not be told
  // it does not exist because of its capitalisation.
  it('corrects the case of an otherwise valid identifier', () => {
    expect(canonicaliseTimezone('europe/london')).toBe('Europe/London');
  });

  it('ignores surrounding whitespace', () => {
    expect(canonicaliseTimezone('  Europe/Paris  ')).toBe('Europe/Paris');
  });

  // Several identifiers are links to another, and which of the pair a runtime
  // reports as canonical depends on its timezone data rather than on anything
  // this application decides. Both are real identifiers and both convert
  // identically, so the requirement is that one usable answer comes back, not
  // that it is the spelling that was asked for.
  it('resolves a linked identifier to whatever the runtime calls it', () => {
    const resolved = canonicaliseTimezone('Asia/Kolkata');

    expect(resolved).not.toBeNull();
    expect(['Asia/Kolkata', 'Asia/Calcutta']).toContain(resolved);
    expect(toUtcInstant('2026-05-01T09:15', resolved as string)).toEqual(
      new Date('2026-05-01T03:45:00.000Z'),
    );
  });

  it('accepts UTC itself', () => {
    expect(canonicaliseTimezone('UTC')).toBe('UTC');
  });

  it('accepts an identifier with three parts', () => {
    expect(canonicaliseTimezone('America/Argentina/Ushuaia')).toBe(
      'America/Argentina/Ushuaia',
    );
  });

  // An abbreviation does not say whether summer time applies, so a value
  // recorded against one could not be converted back reliably.
  it.each(['GMT', 'BST', 'EST', 'CET', 'PST8PDT'])(
    'refuses the abbreviation %s',
    abbreviation => {
      expect(canonicaliseTimezone(abbreviation)).toBeNull();
    },
  );

  it('refuses an identifier that is shaped correctly but unknown', () => {
    expect(canonicaliseTimezone('Nowhere/Atall')).toBeNull();
  });

  // The second call takes the cached answer. Both a remembered success and a
  // remembered failure have to come back the same way the first one did.
  it('returns the same answer when asked twice', () => {
    expect(canonicaliseTimezone('Nowhere/Atall')).toBeNull();
    expect(canonicaliseTimezone('Nowhere/Atall')).toBeNull();
    expect(canonicaliseTimezone('Pacific/Auckland')).toBe('Pacific/Auckland');
    expect(canonicaliseTimezone('Pacific/Auckland')).toBe('Pacific/Auckland');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a bare word', 'London'],
    ['a path traversal', '../etc/passwd'],
    ['a leading slash', '/Europe/London'],
    ['a trailing slash', 'Europe/London/'],
  ])('refuses %s', (_description, candidate) => {
    expect(canonicaliseTimezone(candidate)).toBeNull();
  });
});

describe('isKnownTimezone', () => {
  it('reports a usable identifier as known', () => {
    expect(isKnownTimezone('Australia/Eucla')).toBe(true);
  });

  it('reports an unusable identifier as unknown', () => {
    expect(isKnownTimezone('GMT')).toBe(false);
  });
});

describe('toUtcInstant', () => {
  it('converts a winter time in a zone that observes summer time', () => {
    expect(toUtcInstant('2026-01-15T12:00', 'Europe/London')).toEqual(
      new Date('2026-01-15T12:00:00.000Z'),
    );
  });

  it('converts a summer time using that season’s offset', () => {
    expect(toUtcInstant('2026-07-15T12:00', 'Europe/London')).toEqual(
      new Date('2026-07-15T11:00:00.000Z'),
    );
  });

  it('converts a zone whose offset is not a whole number of hours', () => {
    expect(toUtcInstant('2026-05-01T09:15', 'Asia/Kolkata')).toEqual(
      new Date('2026-05-01T03:45:00.000Z'),
    );
  });

  it('converts a zone offset by three quarters of an hour', () => {
    expect(toUtcInstant('2026-05-01T09:15', 'Australia/Eucla')).toEqual(
      new Date('2026-05-01T00:30:00.000Z'),
    );
  });

  it('converts a zone behind UTC across a date boundary', () => {
    expect(toUtcInstant('2026-07-04T20:00', 'America/New_York')).toEqual(
      new Date('2026-07-05T00:00:00.000Z'),
    );
  });

  it('accepts seconds when they are given', () => {
    expect(toUtcInstant('2026-01-01T12:00:30', 'UTC')).toEqual(
      new Date('2026-01-01T12:00:30.000Z'),
    );
  });

  // On the morning the clocks go forward there is no half past one. Returning
  // half past two instead would record a moment the user did not choose.
  it('refuses a local time inside a spring-forward gap', () => {
    expect(toUtcInstant('2026-03-29T01:30', 'Europe/London')).toBeNull();
  });

  it('converts the minute before a spring-forward gap', () => {
    expect(toUtcInstant('2026-03-29T00:59', 'Europe/London')).toEqual(
      new Date('2026-03-29T00:59:00.000Z'),
    );
  });

  it('converts the minute the clocks jump to', () => {
    expect(toUtcInstant('2026-03-29T02:00', 'Europe/London')).toEqual(
      new Date('2026-03-29T01:00:00.000Z'),
    );
  });

  // On the morning the clocks go back the same local time happens twice. The
  // earlier of the two is taken, and it has to be taken every time.
  it('resolves a repeated autumn hour to the earlier instant', () => {
    expect(toUtcInstant('2026-10-25T01:30', 'Europe/London')).toEqual(
      new Date('2026-10-25T00:30:00.000Z'),
    );
  });

  it('converts a southern-hemisphere summer time', () => {
    expect(toUtcInstant('2026-01-15T12:00', 'Pacific/Auckland')).toEqual(
      new Date('2026-01-14T23:00:00.000Z'),
    );
  });

  it('refuses an unknown timezone', () => {
    expect(toUtcInstant('2026-01-15T12:00', 'Nowhere/Atall')).toBeNull();
  });

  it.each([
    ['a date with no time', '2026-01-15'],
    ['a full ISO instant', '2026-01-15T12:00:00.000Z'],
    ['a two-digit year', '26-01-15T12:00'],
    ['nothing at all', ''],
    ['month zero', '2026-00-15T12:00'],
    ['month thirteen', '2026-13-15T12:00'],
    ['day zero', '2026-01-00T12:00'],
    ['the thirtieth of February', '2026-02-30T12:00'],
    ['the thirty-first of a thirty-day month', '2026-04-31T12:00'],
    ['the twenty-ninth of a common February', '2026-02-29T12:00'],
    ['hour twenty-four', '2026-01-01T24:00'],
    ['minute sixty', '2026-01-01T12:60'],
    ['second sixty', '2026-01-01T12:00:60'],
  ])('refuses %s', (_description, localDateTime) => {
    expect(toUtcInstant(localDateTime, 'UTC')).toBeNull();
  });

  it('accepts the twenty-ninth of February in a leap year', () => {
    expect(toUtcInstant('2028-02-29T12:00', 'UTC')).toEqual(
      new Date('2028-02-29T12:00:00.000Z'),
    );
  });

  // `Date.UTC` reads a year below one hundred as a nineteen-hundreds
  // shorthand. A date silently moved by nineteen centuries would pass every
  // other check.
  it('keeps a two-digit year in its own century', () => {
    expect(toUtcInstant('0050-06-01T12:00', 'UTC')?.getUTCFullYear()).toBe(50);
  });
});

describe('toLocalDateTime', () => {
  it('recovers the local time an instant was entered as', () => {
    expect(
      toLocalDateTime(new Date('2026-07-15T11:00:00Z'), 'Europe/London'),
    ).toBe('2026-07-15T12:00:00');
  });

  it('recovers a local time in a zone offset by half an hour', () => {
    expect(
      toLocalDateTime(new Date('2026-05-01T03:45:00Z'), 'Asia/Kolkata'),
    ).toBe('2026-05-01T09:15:00');
  });

  it('applies the offset in force at that instant, not today’s', () => {
    expect(
      toLocalDateTime(new Date('2026-01-15T12:00:00Z'), 'Europe/London'),
    ).toBe('2026-01-15T12:00:00');
  });

  it('refuses an unknown timezone', () => {
    expect(toLocalDateTime(new Date('2026-01-15T12:00:00Z'), 'GMT')).toBeNull();
  });

  it('round-trips every conversion it makes', () => {
    const timezones = [
      'Europe/London',
      'America/New_York',
      'Asia/Kolkata',
      'Australia/Eucla',
      'Pacific/Auckland',
      'UTC',
    ];

    for (const timezone of timezones) {
      const local = '2026-06-15T14:30:00';
      const instant = toUtcInstant(local, timezone);

      expect(instant).not.toBeNull();
      expect(toLocalDateTime(instant as Date, timezone)).toBe(local);
    }
  });
});
