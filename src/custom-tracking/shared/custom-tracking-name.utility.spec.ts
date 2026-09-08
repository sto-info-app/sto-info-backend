import { normaliseName, tidyName } from './custom-tracking-name.utility';

describe('normaliseName', () => {
  it('folds case, so two spellings of a name are one name', () => {
    expect(normaliseName('Ship Names')).toBe('ship names');
    expect(normaliseName('ship names')).toBe('ship names');
  });

  it('trims the ends', () => {
    expect(normaliseName('  Ships  ')).toBe('ships');
  });

  // A doubled space is invisible on the page, so two Sections separated only
  // by one would be two nobody could tell apart.
  it('collapses runs of whitespace', () => {
    expect(normaliseName('Ship  names')).toBe('ship names');
    expect(normaliseName('Ship\tnames')).toBe('ship names');
    expect(normaliseName('Ship\nnames')).toBe('ship names');
  });

  it('leaves a name that needs nothing done to it', () => {
    expect(normaliseName('ships')).toBe('ships');
  });
});

describe('tidyName', () => {
  it('keeps the capitalisation the user chose', () => {
    expect(tidyName('Ship Names')).toBe('Ship Names');
  });

  it('removes whitespace the user did not intend', () => {
    expect(tidyName('  Ship  Names  ')).toBe('Ship Names');
  });
});
