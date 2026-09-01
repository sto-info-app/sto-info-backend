import { BadRequestException } from '@nestjs/common';
import {
  assertImageSupplied,
  STORYTIME_IMAGE_FIELD,
  STORYTIME_IMAGE_UPLOAD_OPTIONS,
  STORYTIME_IMAGE_UPLOAD_SCHEMA,
} from './storytime-image-upload.options';

describe('Storytime image upload options', () => {
  describe('the file filter', () => {
    /**
     * Runs the filter against a MIME type and reports what it decided.
     *
     * @param mimetype - The type the request claimed.
     * @returns The error and acceptance the filter passed back.
     */
    const filter = (
      mimetype: string,
    ): { error: Error | null; accepted: boolean } => {
      let outcome = { error: null as Error | null, accepted: false };

      STORYTIME_IMAGE_UPLOAD_OPTIONS.fileFilter!(
        {} as never,
        { mimetype } as Express.Multer.File,
        (error: Error | null, accepted: boolean) => {
          outcome = { error, accepted };
        },
      );

      return outcome;
    };

    it.each(['image/png', 'image/jpeg', 'image/jpg'])(
      'accepts %s',
      mimetype => {
        expect(filter(mimetype)).toEqual({ error: null, accepted: true });
      },
    );

    it('refuses anything else', () => {
      const outcome = filter('image/svg+xml');

      expect(outcome.accepted).toBe(false);
      expect(outcome.error).toBeInstanceOf(BadRequestException);
    });
  });

  describe('the limits', () => {
    // The site-wide defaults allow no text fields at all, and a Storytime
    // upload carries its alternative text alongside the file.
    it('allows exactly one file and one field', () => {
      expect(STORYTIME_IMAGE_UPLOAD_OPTIONS.limits).toMatchObject({
        files: 1,
        fields: 1,
        parts: 3,
      });
    });
  });

  describe('the documented body', () => {
    it('requires both the file and its description', () => {
      expect(STORYTIME_IMAGE_UPLOAD_SCHEMA.schema.required).toEqual([
        STORYTIME_IMAGE_FIELD,
        'altText',
      ]);
    });
  });

  describe('assertImageSupplied', () => {
    it('passes a file through', () => {
      expect(() =>
        assertImageSupplied({} as Express.Multer.File),
      ).not.toThrow();
    });

    it('complains when the file part is missing or was rejected', () => {
      expect(() => assertImageSupplied(undefined)).toThrow(
        new BadRequestException('An image file is required'),
      );
    });
  });
});
