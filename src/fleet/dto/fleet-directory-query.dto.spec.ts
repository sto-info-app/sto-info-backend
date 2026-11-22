import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  FleetCommunityDirectoryQueryDto,
  MAX_DIRECTORY_SEARCH_LENGTH,
  StoArmadaDirectoryQueryDto,
  StoFleetDirectoryQueryDto,
} from './fleet-directory-query.dto';

type DirectoryQueryType =
  | typeof FleetCommunityDirectoryQueryDto
  | typeof StoArmadaDirectoryQueryDto
  | typeof StoFleetDirectoryQueryDto;

/**
 * Reads a query string as the global pipe would.
 *
 * @param type - The DTO.
 * @param query - The query as sent.
 * @returns The search it ended up holding, and the properties that failed.
 */
async function read(
  type: DirectoryQueryType,
  query: Record<string, unknown>,
): Promise<{ search: string | undefined; failures: string[] }> {
  const dto = plainToInstance(type, query);
  const errors = await validate(dto);

  return { search: dto.search, failures: errors.map(e => e.property) };
}

describe('directory search terms', () => {
  describe.each([
    ['Fleet', StoFleetDirectoryQueryDto],
    ['Armada', StoArmadaDirectoryQueryDto],
  ] as const)('the %s directory', (_scope, type) => {
    // ADR-0003: " Omega" and "Omega" are two different in-game names.
    it('keeps a space at either end of the term', async () => {
      await expect(read(type, { search: ' Omega ' })).resolves.toEqual({
        search: ' Omega ',
        failures: [],
      });
    });

    it('treats a term of spaces alone as no search', async () => {
      await expect(read(type, { search: '   ' })).resolves.toEqual({
        search: undefined,
        failures: [],
      });
    });

    it('refuses a term that is not text', async () => {
      await expect(read(type, { search: ['a', 'b'] })).resolves.toEqual(
        expect.objectContaining({ failures: ['search'] }),
      );
    });

    // Sixty-four characters from outside the basic plane: 128 UTF-16 units,
    // and still a name the site will hold.
    it('accepts the longest name the site holds, however it is written', async () => {
      const name = String.fromCodePoint(0x1d56c).repeat(64);

      await expect(read(type, { search: name })).resolves.toEqual({
        search: name,
        failures: [],
      });
    });

    it('refuses a term longer than any listing accepts', async () => {
      await expect(
        read(type, { search: 'x'.repeat(MAX_DIRECTORY_SEARCH_LENGTH + 1) }),
      ).resolves.toEqual(expect.objectContaining({ failures: ['search'] }));
    });
  });

  // A Community's name is trimmed when it is saved, so its search is too.
  describe('the Community directory', () => {
    it('trims the term', async () => {
      await expect(
        read(FleetCommunityDirectoryQueryDto, { search: ' Jupiter ' }),
      ).resolves.toEqual({ search: 'Jupiter', failures: [] });
    });

    it('accepts the longest name a Community may have', async () => {
      const name = 'x'.repeat(120);

      await expect(
        read(FleetCommunityDirectoryQueryDto, { search: name }),
      ).resolves.toEqual({ search: name, failures: [] });
    });

    it('refuses a term longer than any listing accepts', async () => {
      await expect(
        read(FleetCommunityDirectoryQueryDto, {
          search: 'x'.repeat(MAX_DIRECTORY_SEARCH_LENGTH + 1),
        }),
      ).resolves.toEqual(expect.objectContaining({ failures: ['search'] }));
    });

    it('passes anything that is not text on for validation to refuse', async () => {
      await expect(
        read(FleetCommunityDirectoryQueryDto, { search: 42 }),
      ).resolves.toEqual(expect.objectContaining({ failures: ['search'] }));
    });
  });
});

describe('StoFleetDirectoryQueryDto', () => {
  it.each([
    ['true', true],
    [true, true],
    ['false', false],
    [false, false],
  ])('reads withRoster=%p as %p', (value, expected) => {
    expect(
      plainToInstance(StoFleetDirectoryQueryDto, { withRoster: value })
        .withRoster,
    ).toBe(expected);
  });

  // "Present, therefore true" would return the opposite of what was asked.
  it('refuses a withRoster that is not a boolean', async () => {
    const errors = await validate(
      plainToInstance(StoFleetDirectoryQueryDto, { withRoster: 'yes' }),
    );

    expect(errors.map(e => e.property)).toEqual(['withRoster']);
  });

  it('reads the freshness window as a number of days', () => {
    expect(
      plainToInstance(StoFleetDirectoryQueryDto, { freshWithinDays: '30' })
        .freshWithinDays,
    ).toBe(30);
  });
});
