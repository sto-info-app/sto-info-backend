import {
  normaliseRosterAccountHandle,
  normaliseRosterCharacterName,
  rosterRowFullHandle,
} from './roster-identity.utility';

describe('roster identity folding', () => {
  describe('normaliseRosterCharacterName', () => {
    it('folds case', () => {
      expect(normaliseRosterCharacterName('Vex LORAN')).toBe('vex loran');
    });

    // The same visible name typed two ways has to be one name, or the
    // database would accept a member the reader refused as listed twice.
    it('composes a letter and its combining mark into one', () => {
      const decomposed = 'Ze\u0301lia';
      const composed = 'Z\u00e9lia';

      expect(normaliseRosterCharacterName(decomposed)).toBe(
        normaliseRosterCharacterName(composed),
      );
    });

    // A leading space is how two Characters are deliberately told apart.
    it('keeps a leading space', () => {
      expect(normaliseRosterCharacterName(' Vex Loran')).toBe(' vex loran');
    });
  });

  describe('normaliseRosterAccountHandle', () => {
    it('folds a handle the way the site folds its own', () => {
      expect(normaliseRosterAccountHandle(' @VexLoran ')).toBe('@vexloran');
    });
  });

  describe('rosterRowFullHandle', () => {
    it('folds a row into a Character full handle with one @', () => {
      expect(rosterRowFullHandle('Vex Loran', '@VexLoran#1234')).toBe(
        'vex loran@vexloran#1234',
      );
    });

    it('takes a handle exported without its @ the same way', () => {
      expect(rosterRowFullHandle('Vex Loran', 'VexLoran')).toBe(
        'vex loran@vexloran',
      );
    });
  });
});
