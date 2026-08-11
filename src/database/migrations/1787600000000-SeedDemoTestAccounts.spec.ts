import { SeedDemoTestAccounts1787600000000 } from './1787600000000-SeedDemoTestAccounts';

describe('SeedDemoTestAccounts1787600000000', () => {
  it('loads lookup data from the current character schema tables', async () => {
    const migration = new SeedDemoTestAccounts1787600000000();
    const hasTable = jest.fn(async (tableName: string) => {
      return [
        'sto_info_app.character_general_faction',
        'sto_info_app.character_faction',
        'sto_info_app.character_sex',
        'sto_info_app.character_class',
        'sto_info_app.character_species',
        'sto_info_app.character_recruit_type',
        'sto_info_app.endeavour_perk',
      ].includes(tableName);
    });
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('"character_general_faction"')) {
        return [{ id: 'general-faction-id' }];
      }
      if (sql.includes('"character_faction"')) {
        return [{ id: 'faction-id' }];
      }
      if (sql.includes('"character_sex"')) {
        return [{ id: 'sex-id' }];
      }
      if (sql.includes('"character_class"')) {
        return [{ id: 'class-id' }];
      }
      if (sql.includes('"character_species"')) {
        return [{ id: 'species-id' }];
      }
      if (sql.includes('"character_recruit_type"')) {
        return [{ id: 'recruit-type-id' }];
      }
      if (sql.includes('"endeavour_perk"')) {
        return [{ id: 'perk-id' }];
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const lookupData = await (migration as any).loadLookupData({
      hasTable,
      query,
    });

    expect(lookupData).toEqual({
      generalFactions: [{ id: 'general-faction-id' }],
      factions: [{ id: 'faction-id' }],
      sexes: [{ id: 'sex-id' }],
      characterClasses: [{ id: 'class-id' }],
      species: [{ id: 'species-id' }],
      recruitTypes: [{ id: 'recruit-type-id' }],
      perkIds: ['perk-id'],
    });
  });

  it('creates at least one character per account', () => {
    const migration = new SeedDemoTestAccounts1787600000000();

    expect((migration as any).getCharacterCount(0, 0)).toBe(1);
    expect((migration as any).getCharacterCount(1, 0)).toBe(2);
    expect((migration as any).getCharacterCount(4, 0)).toBe(5);
  });

  it('keeps @ in captain lookup slugs so registry URLs resolve', () => {
    const migration = new SeedDemoTestAccounts1787600000000();

    expect((migration as any).toSlug('demo-char-001-01-01@demo-001-01')).toBe(
      'demo-char-001-01-01@demo-001-01',
    );
  });

  it('normalizes handles by trimming and lower-casing only', () => {
    const migration = new SeedDemoTestAccounts1787600000000();

    expect((migration as any).normalizeHandle('  Rex@SteveX#1234  ')).toBe(
      'rex@stevex#1234',
    );
  });
});
