import { BadRequestException } from '@nestjs/common';

import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';

/**
 * The privacy parser's refusal to continue.
 *
 * Carries a code and, where the failure belongs to one line, a physical line
 * number. It carries nothing else, and that is the point: an error object is
 * a sink like any other, and this one gets serialised into an HTTP response,
 * written to a log and — if anything goes wrong upstream — attached to a
 * Sentry event. An exception whose message quoted the offending row would
 * defeat the module it lives in.
 *
 * The line number counts physical lines from one, with the header as line one,
 * so it matches what a person sees in a text editor.
 */
export class RosterCsvRejectedError extends Error {
  /**
   * Creates an instance of RosterCsvRejectedError.
   *
   * @param code - Why the upload was refused.
   * @param line - The physical line at fault, or null for a whole-file
   *   failure.
   */
  constructor(
    readonly code: RosterCsvRejectionCode,
    readonly line: number | null = null,
  ) {
    // The message is built from the code and the line number and from nothing
    // else. Both are values this module produced; neither came from the file.
    super(
      line === null
        ? `Roster upload refused: ${code}`
        : `Roster upload refused: ${code} at line ${line}`,
    );

    this.name = 'RosterCsvRejectedError';
  }

  /**
   * Turns the refusal into the answer the uploader is given.
   *
   * The body is the code and the line number and nothing else — no excerpt,
   * no field, no sample. Both values were produced by this application rather
   * than read out of the file.
   *
   * It lives on the error so that every path answering a refusal answers it
   * the same way. There are two of them now — the upload and the preview that
   * precedes it — and an uploader who is told one thing when checking a file
   * and another when sending it has been told nothing.
   *
   * @returns The exception to throw in its place.
   */
  toBadRequest(): BadRequestException {
    return new BadRequestException({
      message:
        'This roster export could not be read. Nothing has been imported.',
      code: this.code,
      line: this.line,
    });
  }
}
