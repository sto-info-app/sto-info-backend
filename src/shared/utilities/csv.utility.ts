/** A value a CSV cell may hold. */
export type CsvValue = string | number | boolean | Date | null;

/** The byte order mark a spreadsheet needs to read UTF-8 as UTF-8. */
export const CSV_BOM = String.fromCodePoint(0xfeff);

/** Characters that start a formula in a spreadsheet. */
const FORMULA_STARTS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Writes one CSV cell.
 *
 * RFC 4180: a cell holding a comma, a quote or a line break is quoted, and
 * its quotes doubled. Text a spreadsheet would run as a formula — anything
 * starting `=`, `+`, `-`, `@`, a tab or a carriage return — is prefixed with
 * an apostrophe, since a cell's text can be somebody's Character name. A
 * number is written as it is: a negative number is not a formula.
 *
 * @param value - The value.
 * @returns The cell.
 */
export function csvCell(value: CsvValue): string {
  if (value === null) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== 'string') {
    return String(value);
  }

  const text = FORMULA_STARTS.has(value.charAt(0)) ? `'${value}` : value;

  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Writes rows of cells as CSV, each line ended with CRLF as RFC 4180 has it.
 *
 * @param rows - The rows.
 * @returns The CSV text, without a byte order mark.
 */
export function toCsv(rows: ReadonlyArray<readonly CsvValue[]>): string {
  return rows.map(row => `${row.map(csvCell).join(',')}\r\n`).join('');
}
