/**
 * The identifiers accepted as a timezone.
 *
 * An IANA identifier in `Area/Location` form, such as `Europe/London`, plus
 * `UTC` itself. The database also contains abbreviation-style names — `GMT`,
 * `EST`, `CET` — and those are deliberately refused: an abbreviation does not
 * say whether summer time applies, so `GMT` and `BST` name the same place at
 * different times of year and neither can be converted from reliably. Refusing
 * them here is what makes every stored timezone answerable.
 */
const IANA_IDENTIFIER_PATTERN =
  /^(?:UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*)+)$/;

/**
 * Canonical spellings already resolved, keyed by what was asked for.
 *
 * Resolving an identifier means constructing an `Intl.DateTimeFormat`, which
 * is expensive enough to be worth not repeating for every value on a page.
 */
const RESOLVED_TIMEZONES = new Map<string, string | null>();

/** One day, used to bracket any daylight-saving transition. */
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * A local date and time, as `YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss`.
 */
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Formats an instant into a named timezone's own calendar fields.
 *
 * `en-US` with `h23` is chosen for machine reading rather than for display:
 * the locale fixes the field order and the hour cycle stops midnight being
 * reported as hour 24, which some locales do and which would move the date by
 * a day when the parts are reassembled.
 */
const ZONED_PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * Determines whether a string is a timezone this runtime knows.
 *
 * @param timezone - The candidate identifier.
 * @returns True when the identifier names a usable IANA timezone.
 */
export function isKnownTimezone(timezone: string | null | undefined): boolean {
  return canonicaliseTimezone(timezone) !== null;
}

/**
 * Returns a timezone identifier in its canonical spelling.
 *
 * Resolved by asking `Intl` what timezone it would actually use, rather than
 * by comparing against a list. That answers both questions at once: an
 * identifier the runtime cannot use throws, and one it can comes back spelled
 * the way the runtime spells it, so `europe/london` is accepted and stored as
 * `Europe/London` rather than being refused for its capitalisation.
 *
 * @param timezone - The candidate identifier, in any case.
 * @returns The canonical identifier, or null when it names no usable timezone.
 */
export function canonicaliseTimezone(
  timezone: string | null | undefined,
): string | null {
  if (typeof timezone !== 'string') {
    return null;
  }

  const candidate = timezone.trim();

  if (!IANA_IDENTIFIER_PATTERN.test(candidate)) {
    return null;
  }

  const cached = RESOLVED_TIMEZONES.get(candidate);

  if (cached !== undefined) {
    return cached;
  }

  const resolved = resolveTimezone(candidate);

  RESOLVED_TIMEZONES.set(candidate, resolved);

  return resolved;
}

/**
 * Asks the runtime to resolve an identifier to the timezone it would use.
 *
 * @param candidate - An identifier that already looks like an IANA name.
 * @returns The canonical identifier, or null when the runtime rejects it.
 */
function resolveTimezone(candidate: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: candidate,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * Converts a local wall-clock date and time in a named timezone to a UTC
 * instant.
 *
 * The offset that applies depends on the instant being calculated, so it
 * cannot simply be looked up and added. Instead both offsets the zone could be
 * using around that date are tried, and the candidate whose own local
 * representation is the time asked for is the answer.
 *
 * Both candidate offsets are tried and each is checked by converting back,
 * which is what tells a real time from one that does not exist and what makes
 * the repeated hour resolve the same way every time.
 *
 * @param localDateTime - The local date and time, as `YYYY-MM-DDTHH:mm` or
 *   `YYYY-MM-DDTHH:mm:ss`.
 * @param timezone - The IANA timezone the local time is expressed in.
 * @returns The UTC instant, or null when the input is malformed, the timezone
 *   is unknown, or the local time does not exist in that timezone. Where the
 *   local time occurs twice, the earlier instant is returned.
 */
export function toUtcInstant(
  localDateTime: string,
  timezone: string,
): Date | null {
  const canonical = canonicaliseTimezone(timezone);
  const fields = parseLocalDateTime(localDateTime);

  if (!canonical || !fields) {
    return null;
  }

  const asIfUtc = utcMillis(fields);

  // The offsets a day either side of the local time bracket any transition it
  // might sit on, so one of these two candidates is the answer for an ordinary
  // time, both are for an ambiguous one, and neither is inside a gap.
  const candidates = [
    asIfUtc - offsetMillisAt(asIfUtc - MILLISECONDS_PER_DAY, canonical),
    asIfUtc - offsetMillisAt(asIfUtc + MILLISECONDS_PER_DAY, canonical),
  ];

  const expected = formatFields(fields);
  const valid = candidates.filter(
    candidate => formatInZone(new Date(candidate), canonical) === expected,
  );

  // Nothing round-trips on the morning a clock goes forward: `01:30` is not a
  // time anybody in that zone can name, and returning `02:30` instead would
  // record a moment the user did not choose.
  if (valid.length === 0) {
    return null;
  }

  // On the morning a clock goes back the same local time happens twice, and
  // both are real instants. The earlier one is taken, which is the convention
  // elsewhere and, more usefully, is the one a person means when they say a
  // thing happened at half past one and are not thinking about it at all.
  return new Date(Math.min(...valid));
}

/**
 * Renders a UTC instant as the local date and time of a named timezone.
 *
 * This is how the local value a user originally entered is recovered. A UTC
 * instant alone cannot do it: the same instant is a different wall-clock time
 * in each zone, and in the same zone before and after a daylight-saving
 * change.
 *
 * @param instant - The UTC instant.
 * @param timezone - The IANA timezone to express it in.
 * @returns The local date and time as `YYYY-MM-DDTHH:mm:ss`, or null when the
 *   timezone is unknown.
 */
export function toLocalDateTime(
  instant: Date,
  timezone: string,
): string | null {
  const canonical = canonicaliseTimezone(timezone);

  if (!canonical) {
    return null;
  }

  return formatInZone(instant, canonical);
}

/**
 * Reads a local date and time into its calendar fields.
 *
 * The fields are also range-checked against the calendar, so `2026-02-30`
 * is refused here rather than silently becoming the second of March when it
 * reaches `Date.UTC`.
 *
 * @param localDateTime - The candidate local date and time.
 * @returns The fields, or null when the string is not a well-formed local
 *   date and time.
 */
function parseLocalDateTime(localDateTime: string): LocalFields | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(localDateTime);

  if (!match) {
    return null;
  }

  const fields: LocalFields = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? '0'),
  };

  if (
    fields.month < 1 ||
    fields.month > 12 ||
    fields.day < 1 ||
    fields.hour > 23 ||
    fields.minute > 59 ||
    fields.second > 59 ||
    fields.day > daysInMonth(fields.year, fields.month)
  ) {
    return null;
  }

  return fields;
}

/**
 * Returns how many days a month has, accounting for leap years.
 *
 * @param year - The year.
 * @param month - The month, counting from one.
 * @returns The number of days in that month.
 */
function daysInMonth(year: number, month: number): number {
  // Day zero of the following month is the last day of this one.
  return new Date(
    utcMillis({
      year,
      month: month + 1,
      day: 0,
      hour: 0,
      minute: 0,
      second: 0,
    }),
  ).getUTCDate();
}

/**
 * Assembles calendar fields into milliseconds since the epoch, as though the
 * fields were UTC.
 *
 * `Date.UTC` is not called directly because it reads a year below one hundred
 * as a nineteen-hundreds shorthand, so the year 50 would become 1950. The
 * feature accepts years from one upwards, and a date silently moved by
 * nineteen centuries is worse than one refused.
 *
 * @param fields - The calendar fields, whose day may be zero to mean the last
 *   day of the preceding month.
 * @returns Milliseconds since the epoch.
 */
function utcMillis(fields: LocalFields): number {
  const assembled = new Date(0);

  assembled.setUTCFullYear(fields.year, fields.month - 1, fields.day);
  assembled.setUTCHours(fields.hour, fields.minute, fields.second, 0);

  return assembled.getTime();
}

/**
 * Returns a timezone's offset from UTC at a given instant, in milliseconds.
 *
 * Derived by asking the timezone what calendar fields the instant has and
 * comparing them with the same instant's UTC fields. That works for every zone
 * including those whose offset is not a whole number of hours, and it reads
 * the historical rules rather than assuming today's.
 *
 * @param instantMillis - The instant, as milliseconds since the epoch.
 * @param timezone - A canonical IANA timezone identifier.
 * @returns The offset, positive east of UTC.
 */
function offsetMillisAt(instantMillis: number, timezone: string): number {
  const parts = zonedParts(new Date(instantMillis), timezone);

  const asIfUtc = utcMillis(parts);

  // Whole seconds only. The formatter reports no smaller unit, so the
  // milliseconds of the original instant would otherwise leak into the offset.
  return asIfUtc - Math.floor(instantMillis / 1000) * 1000;
}

/**
 * Reads an instant's calendar fields in a named timezone.
 *
 * @param instant - The instant.
 * @param timezone - A canonical IANA timezone identifier.
 * @returns The local calendar fields.
 */
function zonedParts(instant: Date, timezone: string): LocalFields {
  const parts: Record<string, string> = {};

  // Collected into a record rather than searched one field at a time. Every
  // field asked for is a field the formatter returns, so a lookup that could
  // fail would be a branch no test could reach and no reader could justify.
  for (const part of formatter(timezone).formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Renders an instant as a local date and time string in a named timezone.
 *
 * @param instant - The instant.
 * @param timezone - A canonical IANA timezone identifier.
 * @returns The local date and time as `YYYY-MM-DDTHH:mm:ss`.
 */
function formatInZone(instant: Date, timezone: string): string {
  return formatFields(zonedParts(instant, timezone));
}

/**
 * Renders calendar fields as a local date and time string.
 *
 * @param fields - The calendar fields.
 * @returns The local date and time as `YYYY-MM-DDTHH:mm:ss`.
 */
function formatFields(fields: LocalFields): string {
  const pad = (value: number, width = 2): string =>
    String(value).padStart(width, '0');

  return `${pad(fields.year, 4)}-${pad(fields.month)}-${pad(fields.day)}T${pad(fields.hour)}:${pad(fields.minute)}:${pad(fields.second)}`;
}

/**
 * Returns the reusable formatter for a timezone.
 *
 * Constructing an `Intl.DateTimeFormat` is expensive enough that doing it per
 * value would show up on a page loading a whole Character's worth of them.
 *
 * @param timezone - A canonical IANA timezone identifier.
 * @returns The formatter for that zone.
 */
function formatter(timezone: string): Intl.DateTimeFormat {
  const existing = ZONED_PARTS_FORMATTERS.get(timezone);

  if (existing) {
    return existing;
  }

  const created = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  ZONED_PARTS_FORMATTERS.set(timezone, created);

  return created;
}

/** A local date and time broken into its calendar fields. */
interface LocalFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}
