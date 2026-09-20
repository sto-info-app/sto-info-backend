/**
 * The longest media type this will return.
 *
 * The contract carries the normalised value and refuses anything longer, so
 * refusing it here means the refusal happens where the value is written
 * rather than when a scan is requested for it days later.
 */
const MAX_MEDIA_TYPE_LENGTH = 127;

/** A bare media type: lowercase, no parameters, no wildcards. */
const BARE_MEDIA_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/;

/**
 * The spellings browsers use for types this site accepts.
 *
 * Every entry is a name for something the canonical type already describes,
 * and that is the rule for adding one: `image/jpg` and `image/jpeg` are the
 * same format under two names, so mapping one to the other loses nothing. A
 * type that is merely *related* does not belong here — an `.xlsx` workbook
 * is not a CSV, however often somebody uploads one expecting it to be.
 *
 * `application/octet-stream` is deliberately absent. It is not another name
 * for anything; it means the browser had no idea. A caller that knows what
 * it received says so itself, which is what the roster upload does.
 */
const MEDIA_TYPE_ALIASES: ReadonlyMap<string, string> = new Map([
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
  ['image/x-citrix-jpeg', 'image/jpeg'],
  ['image/x-png', 'image/png'],
  ['image/x-citrix-png', 'image/png'],
  ['application/csv', 'text/csv'],
  ['application/x-csv', 'text/csv'],
  ['text/comma-separated-values', 'text/csv'],
  ['text/x-comma-separated-values', 'text/csv'],
  ['application/vnd.ms-excel', 'text/csv'],
  ['application/excel', 'text/csv'],
  ['application/x-excel', 'text/csv'],
]);

/**
 * Reduces a media type to the one spelling everything else compares against.
 *
 * Three things happen, in order: the parameters are dropped, what is left is
 * lowercased and trimmed, and the result is looked up in the alias table.
 * `TEXT/CSV; charset=UTF-8` and `application/vnd.ms-excel` both come out as
 * `text/csv`, which is what the bytes were all along.
 *
 * Why the backend does this rather than the worker: the worker compares a
 * declared type with what the bytes look like, and a comparison is only as
 * good as the spellings reaching it. Doing it here means one table, applied
 * where a type is written, instead of every consumer growing its own idea of
 * which names mean the same thing — ADR-0020.
 *
 * @param declared - Whatever the upload claimed, if anything.
 * @returns The canonical type, or null when there is nothing usable.
 */
export function normaliseMediaType(declared: string | null): string | null {
  if (declared === null) {
    return null;
  }

  const bare = declared.split(';')[0].trim().toLowerCase();

  if (bare.length === 0 || bare.length > MAX_MEDIA_TYPE_LENGTH) {
    return null;
  }

  const canonical = MEDIA_TYPE_ALIASES.get(bare) ?? bare;

  return BARE_MEDIA_TYPE.test(canonical) ? canonical : null;
}
