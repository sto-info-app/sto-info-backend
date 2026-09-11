import {
  CharacterSortBy,
  CharacterSortOrder,
  SortableCharacter,
  sortCharacters,
} from './character-sort.utility';

describe('sortCharacters', () => {
  const captain = (
    handle: string,
    overrides: Partial<SortableCharacter> = {},
  ): SortableCharacter => ({
    handle,
    level: null,
    createdDate: null,
    pinnedAt: null,
    species: null,
    faction: null,
    class: null,
    ...overrides,
  });

  const handles = (characters: SortableCharacter[]): string[] =>
    characters.map(entry => entry.handle);

  it('orders by handle ascending by default', () => {
    const result = sortCharacters([
      captain('Sisko'),
      captain('Archer'),
      captain('Picard'),
    ]);

    expect(handles(result)).toEqual(['Archer', 'Picard', 'Sisko']);
  });

  it('orders by handle descending', () => {
    const result = sortCharacters(
      [captain('Archer'), captain('Sisko'), captain('Picard')],
      CharacterSortBy.Handle,
      CharacterSortOrder.Desc,
    );

    expect(handles(result)).toEqual(['Sisko', 'Picard', 'Archer']);
  });

  // Handles are user-chosen and mixed case, so ordering must not put every
  // lower-case handle after every upper-case one.
  it('compares handles case-insensitively', () => {
    const result = sortCharacters([
      captain('picard'),
      captain('Archer'),
      captain('SISKO'),
    ]);

    expect(handles(result)).toEqual(['Archer', 'picard', 'SISKO']);
  });

  it('does not modify the array it was given', () => {
    const input = [captain('Sisko'), captain('Archer')];

    sortCharacters(input);

    expect(handles(input)).toEqual(['Sisko', 'Archer']);
  });

  describe('by level', () => {
    it('orders ascending', () => {
      const result = sortCharacters(
        [
          captain('Archer', { level: 65 }),
          captain('Picard', { level: 10 }),
          captain('Sisko', { level: 50 }),
        ],
        CharacterSortBy.Level,
      );

      expect(handles(result)).toEqual(['Picard', 'Sisko', 'Archer']);
    });

    it('orders descending', () => {
      const result = sortCharacters(
        [
          captain('Picard', { level: 10 }),
          captain('Archer', { level: 65 }),
          captain('Sisko', { level: 50 }),
        ],
        CharacterSortBy.Level,
        CharacterSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Archer', 'Sisko', 'Picard']);
    });

    // The level is optional, so reversing the order must not promote the
    // captains that simply have nothing recorded to the top of the list.
    it('puts captains with no recorded level last when ascending', () => {
      const result = sortCharacters(
        [captain('Archer'), captain('Sisko', { level: 50 })],
        CharacterSortBy.Level,
      );

      expect(handles(result)).toEqual(['Sisko', 'Archer']);
    });

    it('puts captains with no recorded level last when descending', () => {
      const result = sortCharacters(
        [captain('Archer'), captain('Sisko', { level: 50 })],
        CharacterSortBy.Level,
        CharacterSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Sisko', 'Archer']);
    });

    // The same pair in the opposite input order must reach the same answer, so
    // both sides of the unset-level comparison are exercised.
    it('puts a captain with no recorded level last whichever side it arrives on', () => {
      const result = sortCharacters(
        [captain('Sisko', { level: 50 }), captain('Archer')],
        CharacterSortBy.Level,
      );

      expect(handles(result)).toEqual(['Sisko', 'Archer']);
    });

    it('falls back to handle order between two identical levels', () => {
      const result = sortCharacters(
        [captain('Sisko', { level: 50 }), captain('Archer', { level: 50 })],
        CharacterSortBy.Level,
      );

      expect(handles(result)).toEqual(['Archer', 'Sisko']);
    });

    it('falls back to handle order between two captains with no level', () => {
      const result = sortCharacters(
        [captain('Sisko'), captain('Archer')],
        CharacterSortBy.Level,
      );

      expect(handles(result)).toEqual(['Archer', 'Sisko']);
    });
  });

  describe('by created date', () => {
    const dated = (handle: string, iso: string): SortableCharacter =>
      captain(handle, { createdDate: new Date(iso) });

    it('orders oldest first ascending', () => {
      const result = sortCharacters(
        [
          dated('Sisko', '2015-06-01'),
          dated('Archer', '2010-01-01'),
          dated('Picard', '2012-03-01'),
        ],
        CharacterSortBy.CreatedDate,
      );

      expect(handles(result)).toEqual(['Archer', 'Picard', 'Sisko']);
    });

    it('orders newest first descending', () => {
      const result = sortCharacters(
        [
          dated('Archer', '2010-01-01'),
          dated('Sisko', '2015-06-01'),
          dated('Picard', '2012-03-01'),
        ],
        CharacterSortBy.CreatedDate,
        CharacterSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Sisko', 'Picard', 'Archer']);
    });

    it('puts captains with no recorded date last when ascending', () => {
      const result = sortCharacters(
        [
          captain('Archer'),
          dated('Sisko', '2015-06-01'),
          dated('Picard', '2012-03-01'),
        ],
        CharacterSortBy.CreatedDate,
      );

      expect(handles(result)).toEqual(['Picard', 'Sisko', 'Archer']);
    });

    it('puts captains with no recorded date last when descending', () => {
      const result = sortCharacters(
        [
          captain('Archer'),
          dated('Picard', '2012-03-01'),
          dated('Sisko', '2015-06-01'),
        ],
        CharacterSortBy.CreatedDate,
        CharacterSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Sisko', 'Picard', 'Archer']);
    });

    it('falls back to handle order between two identical dates', () => {
      const result = sortCharacters(
        [dated('Sisko', '2012-03-01'), dated('Archer', '2012-03-01')],
        CharacterSortBy.CreatedDate,
      );

      expect(handles(result)).toEqual(['Archer', 'Sisko']);
    });
  });

  describe('by lookup name', () => {
    const named = (
      handle: string,
      field: 'species' | 'faction' | 'class',
      name: string,
    ): SortableCharacter => captain(handle, { [field]: { name } });

    it.each([
      ['species', CharacterSortBy.Species],
      ['faction', CharacterSortBy.Faction],
      ['class', CharacterSortBy.Class],
    ] as const)('orders by %s ascending', (field, sortBy) => {
      const result = sortCharacters(
        [
          named('Archer', field, 'Vulcan'),
          named('Picard', field, 'Andorian'),
          named('Sisko', field, 'Bajoran'),
        ],
        sortBy,
      );

      expect(handles(result)).toEqual(['Picard', 'Sisko', 'Archer']);
    });

    it.each([
      ['species', CharacterSortBy.Species],
      ['faction', CharacterSortBy.Faction],
      ['class', CharacterSortBy.Class],
    ] as const)('orders by %s descending', (field, sortBy) => {
      const result = sortCharacters(
        [
          named('Picard', field, 'Andorian'),
          named('Archer', field, 'Vulcan'),
          named('Sisko', field, 'Bajoran'),
        ],
        sortBy,
        CharacterSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Archer', 'Sisko', 'Picard']);
    });

    // The relation is optional on the entity, so a captain whose lookup never
    // loaded must not displace the ones that have a name to order by.
    it('puts captains with no loaded relation last in both directions', () => {
      const input = [captain('Archer'), named('Sisko', 'species', 'Bajoran')];

      expect(handles(sortCharacters(input, CharacterSortBy.Species))).toEqual([
        'Sisko',
        'Archer',
      ]);
      expect(
        handles(
          sortCharacters(
            input,
            CharacterSortBy.Species,
            CharacterSortOrder.Desc,
          ),
        ),
      ).toEqual(['Sisko', 'Archer']);
    });

    // The relation can be loaded with no name of its own, which must read the
    // same as no relation at all rather than ordering as an empty string.
    it('puts a loaded relation with no name last whichever side it arrives on', () => {
      const nameless = captain('Archer', { species: { name: null } });
      const withName = named('Sisko', 'species', 'Bajoran');

      expect(
        handles(sortCharacters([nameless, withName], CharacterSortBy.Species)),
      ).toEqual(['Sisko', 'Archer']);
      expect(
        handles(sortCharacters([withName, nameless], CharacterSortBy.Species)),
      ).toEqual(['Sisko', 'Archer']);
    });

    it('compares lookup names case-insensitively', () => {
      const result = sortCharacters(
        [
          named('Archer', 'class', 'tactical'),
          named('Sisko', 'class', 'Science'),
        ],
        CharacterSortBy.Class,
      );

      expect(handles(result)).toEqual(['Sisko', 'Archer']);
    });

    it('falls back to handle order between two identical names', () => {
      const result = sortCharacters(
        [
          named('Sisko', 'faction', 'Starfleet'),
          named('Archer', 'faction', 'Starfleet'),
        ],
        CharacterSortBy.Faction,
      );

      expect(handles(result)).toEqual(['Archer', 'Sisko']);
    });
  });

  describe('pinning', () => {
    const pinned = (
      handle: string,
      overrides: Partial<SortableCharacter> = {},
    ): SortableCharacter =>
      captain(handle, { pinnedAt: new Date('2026-01-01'), ...overrides });

    it('puts pinned captains before unpinned ones', () => {
      const result = sortCharacters([
        captain('Archer'),
        pinned('Sisko'),
        captain('Picard'),
      ]);

      expect(handles(result)).toEqual(['Sisko', 'Archer', 'Picard']);
    });

    it('keeps pinned captains first when ordering descending', () => {
      const result = sortCharacters(
        [captain('Archer'), pinned('Sisko'), captain('Picard')],
        CharacterSortBy.Handle,
        CharacterSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Sisko', 'Picard', 'Archer']);
    });

    // Pinning groups rather than orders: within the pinned block the chosen
    // sort still decides, so a pin does not freeze a captain's position.
    it('applies the chosen sort within the pinned group', () => {
      const result = sortCharacters(
        [
          pinned('Archer', { level: 10 }),
          pinned('Sisko', { level: 65 }),
          captain('Picard', { level: 50 }),
        ],
        CharacterSortBy.Level,
        CharacterSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Sisko', 'Archer', 'Picard']);
    });

    it('applies the chosen sort within the unpinned group', () => {
      const result = sortCharacters(
        [
          captain('Archer', { level: 10 }),
          captain('Sisko', { level: 65 }),
          pinned('Picard', { level: 50 }),
        ],
        CharacterSortBy.Level,
        CharacterSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Picard', 'Sisko', 'Archer']);
    });

    it('leaves the order unchanged when every captain is pinned', () => {
      const result = sortCharacters([pinned('Sisko'), pinned('Archer')]);

      expect(handles(result)).toEqual(['Archer', 'Sisko']);
    });
  });
});
