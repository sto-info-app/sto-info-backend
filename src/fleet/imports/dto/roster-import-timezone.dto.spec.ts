import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PreviewRosterImportDto } from './preview-roster-import.dto';
import { UploadRosterImportDto } from './upload-roster-import.dto';

/**
 * Validates a body as the global pipe would.
 *
 * @param type - The DTO.
 * @param body - The body as sent.
 * @returns The properties that failed.
 */
async function failures<T extends object>(
  type: new () => T,
  body: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, body));

  return errors.map(error => error.property);
}

/**
 * The plan's rule that an export's timezone is never inferred (FC-043,
 * plan §11.2): the server reads no zone it was not told. Both the check and
 * the import refuse a request without a zone, or with one that is not an
 * IANA name; the browser's own zone only ever starts the control, and the
 * check shows every date read through it before anything is imported.
 */
describe('Roster import timezone (FC-043)', () => {
  describe.each([
    ['the check', PreviewRosterImportDto],
    ['the import', UploadRosterImportDto],
  ] as const)('%s', (_name, type) => {
    it.each(['Europe/London', 'America/New_York', 'UTC'])(
      'accepts %s',
      async timezone => {
        await expect(failures(type, { timezone })).resolves.toEqual([]);
      },
    );

    it.each([
      ['no zone at all', {}],
      ['an empty zone', { timezone: '' }],
      ['an abbreviation', { timezone: 'BST' }],
      ['an offset', { timezone: '+01:00' }],
      ['a name no zone has', { timezone: 'Europe/Atlantis' }],
      ['something that is not text', { timezone: 1 }],
    ])('refuses %s', async (_case, body) => {
      await expect(failures(type, body)).resolves.toEqual(['timezone']);
    });
  });
});
