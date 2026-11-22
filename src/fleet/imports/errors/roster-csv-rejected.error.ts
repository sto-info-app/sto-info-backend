import { BadRequestException } from '@nestjs/common';

import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterFilenameRejectionCode } from '../enums/roster-filename-rejection-code.enum';
import { RosterRowProblem } from '../services/roster-typed-parser.service';

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
 *
 * A refusal of the file's values rather than its shape carries the typed
 * reader's problems instead of a single line: each is a line, a column name
 * from the fixed header and a code, and none of them is anything the file
 * said.
 *
 * It carries a filename code as readily as a CSV one. Both describe the
 * shape of what somebody sent rather than anything inside it, both are
 * answered the same way, and a second error class would mean two ways of
 * saying the same thing to the same caller — which is how an uploader ends
 * up being told one thing by the preview and another by the upload.
 */
export class RosterCsvRejectedError extends Error {
  /**
   * Creates an instance of RosterCsvRejectedError.
   *
   * @param code - Why the upload was refused.
   * @param line - The physical line at fault, or null for a whole-file
   *   failure.
   * @param problems - Every row the typed reader refused, for a refusal of
   *   the file's values. Empty for everything else.
   */
  constructor(
    readonly code: RosterCsvRejectionCode | RosterFilenameRejectionCode,
    readonly line: number | null = null,
    readonly problems: readonly RosterRowProblem[] = [],
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
   * The body is the code, the line number and the row problems, and nothing
   * else — no excerpt, no field, no sample. Every value in it was produced
   * by this application rather than read out of the file. The problems are
   * always present, empty for a refusal of the file's shape, so a client
   * reads one body rather than two.
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
      problems: this.problems.map(problem => ({ ...problem })),
    });
  }
}
