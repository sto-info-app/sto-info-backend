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
 * What the registered asset is declared to be.
 *
 * The same type without the parameter, because this one crosses the scan
 * contract, which carries bare media types only. It is a declaration this
 * application makes about its own output rather than a claim it is passing
 * on: the asset holds the sanitised CSV, so `text/csv` is what the worker
 * should find when it looks — ADR-0020.
 */
export const DECLARED_ROSTER_CONTENT_TYPE = 'text/csv';

/** The longest claimed content type the provenance record will hold. */
export const ROSTER_DECLARED_TYPE_MAX_LENGTH = 255;

/**
 * Bounds the uploader's claim so it fits the column that records it.
 *
 * Stored as sent, believed by nothing, and shortened rather than refused: a
 * header this long is a curiosity, not a reason to reject an import that is
 * otherwise fine.
 *
 * @param declared - Whatever arrived on the part's Content-Type.
 * @returns The claim, bounded, or null when there was none.
 */
export function boundDeclaredContentType(
  declared: string | null | undefined,
): string | null {
  const trimmed = declared?.trim() ?? '';

  return trimmed === ''
    ? null
    : trimmed.slice(0, ROSTER_DECLARED_TYPE_MAX_LENGTH);
}

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

/**
 * How a preview upload is parsed off the wire.
 *
 * The upload's options with room for one text field. That field is the
 * timezone, and it is the reason the preview exists: an STO export writes
 * wall-clock times and does not say whose clock they were, so nothing about
 * the file can be read until somebody says.
 *
 * One field and no more. A multipart body with room for arbitrary extra parts
 * is a multipart body somebody will eventually put a second file in.
 */
export const ROSTER_PREVIEW_OPTIONS: MulterOptions = {
  ...ROSTER_UPLOAD_OPTIONS,
  limits: { ...ROSTER_UPLOAD_OPTIONS.limits, fields: 1, parts: 3 },
};

/** The Swagger body description for a preview. */
export const ROSTER_PREVIEW_SCHEMA = {
  schema: {
    type: 'object',
    required: [ROSTER_UPLOAD_FIELD, 'timezone'],
    properties: {
      [ROSTER_UPLOAD_FIELD]: {
        type: 'string',
        format: 'binary',
        description: 'The STO roster export, as the game wrote it.',
      },
      timezone: {
        type: 'string',
        example: 'Europe/London',
        description:
          'The IANA timezone the exporting player’s own clock was set to.',
      },
    },
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
 * What somebody is told when their platform has no export facility.
 *
 * Names the platform, because the reader may well be a Fleet leader who has
 * spent the last ten minutes looking for a menu that is not there, and
 * “your platform” would leave them wondering which of theirs was meant. Says
 * that it may change, because it may: the column this is read from exists so
 * that a console gaining the facility is a row somebody updates.
 *
 * @param platformName - The platform, as the catalogue names it.
 * @returns The refusal, in words.
 */
export function rosterExportUnavailableMessage(platformName: string): string {
  return (
    `The game provides no fleet roster export on ${platformName}, so there ` +
    'is nothing to import. If that changes, this site will accept one.'
  );
}

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
