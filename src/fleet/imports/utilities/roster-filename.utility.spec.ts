import { readRosterFilename } from './roster-filename.utility';

describe('readRosterFilename', () => {
  it('reads the Fleet and the stamp out of an export name', () => {
    expect(readRosterFilename('MidNite Taskforce_20260824-011338.Csv')).toEqual(
      {
        fleetLabel: 'MidNite Taskforce',
        localStamp: '2026-08-24T01:13:38',
      },
    );
  });

  it.each(['.csv', '.CSV', '.Csv', '.cSv'])(
    'accepts the extension written as %p',
    extension => {
      expect(
        readRosterFilename(`Fixture Basic Fleet_20240101-120000${extension}`),
      ).not.toBeNull();
    },
  );

  // Fleet names contain underscores and digits. Reading from the first
  // underscore would cut this one into a Fleet called "House".
  it('reads the stamp from the last one in the name, not the first', () => {
    expect(readRosterFilename('House_of_MidNite_20211221-034426.Csv')).toEqual({
      fleetLabel: 'House_of_MidNite',
      localStamp: '2021-12-21T03:44:26',
    });
  });

  it('leaves an earlier stamp-shaped run in the Fleet label', () => {
    expect(
      readRosterFilename('Archive_20240101-120000_20240102-130000.Csv'),
    ).toEqual({
      fleetLabel: 'Archive_20240101-120000',
      localStamp: '2024-01-02T13:00:00',
    });
  });

  // Three fixtures exist only to prove this. A Fleet whose registered name
  // begins with a space, a hyphen or a guillemet is a different Fleet from one
  // whose name does not.
  it.each([
    '.Fixture Dotted Fleet.',
    '« Fixture Guillemet Fleet »',
    '- Fixture Hyphen Fleet -',
    "Fixture qa'Hom Fleet",
    ' Leading Space Fleet',
    'Trailing Space Fleet ',
  ])('keeps the label %p exactly as written', label => {
    expect(readRosterFilename(`${label}_20240113-120000.Csv`)?.fleetLabel).toBe(
      label,
    );
  });

  // The 34 annotated files in the analysed corpus. Their usefulness as
  // research is not an importer exception: there is nowhere in the grammar
  // for a suffix to go, and stripping one would mean the recorded filename
  // was not the filename.
  it.each([
    'Fixture Suffixed Fleet_20240109-120000 - Steve Export.Csv',
    'MidNite Taskforce_20260824-011338 - Dragon Export.Csv',
    'The SCC_20211128-030000_PrePromotions.Csv',
    'The SCC_20211128-030000_PostPromotions.Csv',
    'The SCC_20211128-030000__20211128.Csv',
  ])('refuses the annotated name %p', filename => {
    expect(readRosterFilename(filename)).toBeNull();
  });

  it.each([
    ['no stamp at all', 'MidNite Taskforce.Csv'],
    ['no Fleet before the stamp', '_20240101-120000.Csv'],
    ['a short date', 'Fleet_2024011-120000.Csv'],
    ['a long date', 'Fleet_202401011-120000.Csv'],
    ['a short time', 'Fleet_20240101-12000.Csv'],
    ['a hyphen where the underscore goes', 'Fleet-20240101-120000.Csv'],
    ['another extension', 'Fleet_20240101-120000.txt'],
    ['no extension', 'Fleet_20240101-120000'],
  ])('refuses a name with %s', (_case, filename) => {
    expect(readRosterFilename(filename)).toBeNull();
  });

  // Shape only. Whether 13 April is the 32nd of anything is a question for
  // the calendar, asked where the stamp is resolved.
  it('reads a stamp whose digits name no real time', () => {
    expect(readRosterFilename('Fleet_20241332-250000.Csv')?.localStamp).toBe(
      '2024-13-32T25:00:00',
    );
  });
});
