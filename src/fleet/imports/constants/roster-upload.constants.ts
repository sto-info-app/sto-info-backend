import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

import { memoryStorage } from 'multer';

import { DEFAULT_MULTER_LIMITS } from 'src/shared/constants/file-upload.constants';

import { ROSTER_CSV_LIMITS } from './roster-csv.constants';

/** The multipart field a roster export arrives in. */
export const ROSTER_UPLOAD_FIELD = 'roster';

/** The longest filename the provenance record will hold, in characters. */
export const ROSTER_FILENAME_MAX_LENGTH = 512;

/**
 * What the sanitised object is recorded as being.
 *
 * Recorded on the registry row as the *detected* type, which is a statement
 * this application is entitled to make: it wrote those bytes itself, from its
 * own serialiser. The uploader's claim about the received file is kept
 * separately as the declared type and is never believed — CSV has no magic
 * number, so a browser's idea of what it sent is worth nothing.
 */
export const SANITISED_ROSTER_CONTENT_TYPE = 'text/csv; charset=utf-8';

/**
 * How a roster upload is parsed off the wire.
 *
 * Memory storage, and that is load-bearing rather than a performance choice.
 * Multer's disk storage would write the received bytes — officer columns and
 * all — to a temporary file before any of this application's code had seen
 * them, and ADR-0001 says those bytes never reach a disk. In memory they can
 * be overwritten the moment the parser is finished with them, which is what
 * {@link RosterImportIngressService} does.
 *
 * One file, no other fields, and a size ceiling that matches the parser's own.
 * The parser checks the size again because it must not trust its caller, but
 * refusing an over-large upload here means the process never holds the bytes
 * at all.
 *
 * There is **no MIME filter**. A CSV has no magic number and the browser's
 * `Content-Type` for one is whatever the operating system's file association
 * happens to say — `text/csv`, `application/vnd.ms-excel` and
 * `application/octet-stream` are all common for the same file. Filtering on it
 * would refuse real uploads while stopping nothing, since the header is
 * supplied by whoever is uploading. What the bytes are is decided by parsing
 * them.
 */
export const ROSTER_UPLOAD_OPTIONS: MulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: ROSTER_CSV_LIMITS.maxSourceBytes,
    fieldSize: ROSTER_CSV_LIMITS.maxSourceBytes,
    files: 1,
    fields: 0,
    parts: 2,
    headerPairs: DEFAULT_MULTER_LIMITS.headerPairs,
  },
};

/** The Swagger body description for a roster upload. */
export const ROSTER_UPLOAD_SCHEMA = {
  schema: {
    type: 'object',
    required: [ROSTER_UPLOAD_FIELD],
    properties: {
      [ROSTER_UPLOAD_FIELD]: {
        type: 'string',
        format: 'binary',
        description: 'The STO roster export, as the game wrote it.',
      },
    },
  },
};

/**
 * Requires that a file actually arrived with the request.
 *
 * @param file - Whatever Multer parsed, if anything.
 * @throws BadRequestException when no file was supplied.
 */
export function assertRosterSupplied(
  file: Express.Multer.File | undefined,
): asserts file is Express.Multer.File {
  if (!file) {
    throw new BadRequestException('A roster export file is required');
  }
}
