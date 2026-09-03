import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

import { memoryStorage } from 'multer';

import {
  DEFAULT_MULTER_LIMITS,
  isAllowedImageMimeType,
} from 'src/shared/constants/file-upload.constants';

/** The multipart field the cropped image arrives in. */
export const STORYTIME_IMAGE_FIELD = 'image';

/**
 * How a Storytime image upload is parsed off the wire.
 *
 * Almost the shared defaults, with one difference: a Storytime upload carries
 * its alternative text alongside the file, and the site-wide defaults allow no
 * text fields at all. The allowance is one field and one file rather than
 * "some", so a request carrying anything else is refused by the parser before
 * a validator has to have an opinion about it.
 *
 * The size ceiling here is the site-wide one. Storytime's own, which an
 * administrator may set lower for an individual, is applied afterwards against
 * the parsed file — Multer's limits are fixed when the route is declared and
 * cannot know who is calling.
 */
export const STORYTIME_IMAGE_UPLOAD_OPTIONS: MulterOptions = {
  storage: memoryStorage(),
  fileFilter: (_request, file, callback) => {
    if (isAllowedImageMimeType(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(
      new BadRequestException(
        'Invalid file type. Only PNG, JPG, or JPEGs are allowed.',
      ),
      false,
    );
  },
  limits: {
    fileSize:
      +process.env.MAX_IMAGE_SIZE_IN_BYTES! || DEFAULT_MULTER_LIMITS.fileSize,
    fieldSize:
      +process.env.MAX_IMAGE_SIZE_IN_BYTES! || DEFAULT_MULTER_LIMITS.fieldSize,
    files: 1,
    fields: 1,
    parts: 3,
    headerPairs: DEFAULT_MULTER_LIMITS.headerPairs,
  },
};

/**
 * The Swagger body description shared by every Storytime image upload.
 */
export const STORYTIME_IMAGE_UPLOAD_SCHEMA = {
  schema: {
    type: 'object',
    required: [STORYTIME_IMAGE_FIELD, 'altText'],
    properties: {
      [STORYTIME_IMAGE_FIELD]: {
        type: 'string',
        format: 'binary',
        description: 'The cropped image, as PNG or JPEG depending on the slot.',
      },
      altText: {
        type: 'string',
        description: 'What the image shows, for readers who cannot see it.',
      },
    },
  },
};

/**
 * Requires that a file actually arrived with the request.
 *
 * Multer leaves the file undefined when the part is missing or was rejected by
 * the filter, and every image route needs the same complaint about it.
 *
 * @param file - Whatever Multer parsed, if anything.
 * @throws BadRequestException when no file was supplied.
 */
export function assertImageSupplied(
  file: Express.Multer.File | undefined,
): asserts file is Express.Multer.File {
  if (!file) {
    throw new BadRequestException('An image file is required');
  }
}
