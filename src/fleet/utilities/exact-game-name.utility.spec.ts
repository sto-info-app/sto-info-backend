import {
  EXACT_GAME_NAME_FORBIDDEN_PATTERN,
  EXACT_GAME_NAME_MAX_CODEPOINTS,
} from '../constants/fleet-name.constants';
import {
  countCodepoints,
  findExactGameNameProblem,
  isValidExactGameName,
  toComparableExactGameName,
  toNormalisedExactGameName,
} from './exact-game-name.utility';

/**
 * ADR-0003's rule, tested against the archive it has to serve.
 *
 * The names below are real: they are Fleet labels from the 1,199-file roster
 * archive the plan's corpus findings came from. Four of them are the reason
 * the documented in-game rule was not implemented, and they are here so that
 * anyone tempted to tighten the rule later finds out immediately which real
 * Fleets they have just locked out.
 */
describe('exact game name', () => {
  /** Fleet labels taken from the corpus, with what makes each one awkward. */
  const CORPUS = [
    ['Ferengi Commerce Authority Bankers', '34 codepoints, over the stated 32'],
    ['« Omega Armada »', 'guillemets, the only non-ASCII in the corpus'],
    ["boq botlhra'ghom", 'an apostrophe, as every Klingon name has'],
    ["mey'elStrem boq", 'an apostrophe and inner capitals'],
    ['.Darkstar Command.', 'bracketed by full stops'],
    ['- Omega Armada -', 'bracketed by hyphens and spaces'],
    ['-DME- Division Mu Epsilon', 'a leading hyphen'],
    ['The SCC', 'the shortest label, at seven'],
  ] as const;

  describe('what it accepts', () => {
    it.each(CORPUS)('accepts %s — %s', name => {
      expect(findExactGameNameProblem(name)).toBeNull();
      expect(isValidExactGameName(name)).toBe(true);
    });

    /**
     * Steve's ruling of 21 September 2026, and the one that reversed what
     * ADR-0003 originally proposed. Silent trimming was declined because it
     * mutates the stored value and would stop the name matching a roster
     * filename that carries the space.
     */
    it('accepts a leading or trailing space and does not touch it', () => {
      expect(isValidExactGameName(' Omega Armada')).toBe(true);
      expect(isValidExactGameName('Omega Armada ')).toBe(true);
      expect(toComparableExactGameName(' Omega Armada ')).toBe(
        ' Omega Armada ',
      );
    });

    it('accepts scripts the corpus has never seen', () => {
      expect(isValidExactGameName('Флот Омега')).toBe(true);
      expect(isValidExactGameName('艦隊オメガ')).toBe(true);
      expect(isValidExactGameName('🖖 Vulcan High Command')).toBe(true);
    });

    /**
     * The symbols the documented in-game rule forbids. STO Info holds them
     * anyway: a name the game refuses simply never turns up, whereas a name
     * the game allows and this app refuses is a Fleet that cannot register.
     */
    it('accepts the symbols the game is said to forbid', () => {
      for (const name of ['Fleet@Home', 'Fleet_31', 'Fleet*Star', 'Fleet$']) {
        expect(isValidExactGameName(name)).toBe(true);
      }
    });

    it('accepts exactly the longest permitted name', () => {
      expect(
        isValidExactGameName('a'.repeat(EXACT_GAME_NAME_MAX_CODEPOINTS)),
      ).toBe(true);
    });
  });

  describe('what it refuses', () => {
    it.each([
      ['an empty name', ''],
      ['a name of nothing but spaces', '   '],
      ['a name of nothing but other whitespace', '\u00A0\u2003'],
    ])('refuses %s', (_label, value) => {
      expect(findExactGameNameProblem(value)).toBe('EMPTY');
    });

    it('refuses one codepoint past the bound', () => {
      expect(
        findExactGameNameProblem(
          'a'.repeat(EXACT_GAME_NAME_MAX_CODEPOINTS + 1),
        ),
      ).toBe('TOO_LONG');
    });

    it.each([
      ['a newline', 'Omega\nArmada'],
      ['a carriage return', 'Omega\rArmada'],
      ['a tab', 'Omega\tArmada'],
      ['a null', 'Omega\u0000Armada'],
      ['a C1 control character', 'Omega\u0085Armada'],
    ])('refuses %s', (_label, value) => {
      expect(findExactGameNameProblem(value)).toBe('CONTROL_CHARACTER');
    });

    it('refuses anything that is not a string', () => {
      for (const value of [undefined, null, 42, {}, ['Omega']]) {
        expect(isValidExactGameName(value)).toBe(false);
      }
    });

    /**
     * The order matters for the message. A pasted value carrying a newline is
     * usually also over-long, and being told to shorten a name that looks
     * fine sends the registrant hunting for the wrong problem.
     */
    it('reports the control character before the length', () => {
      expect(
        findExactGameNameProblem(
          `${'a'.repeat(EXACT_GAME_NAME_MAX_CODEPOINTS + 1)}\n`,
        ),
      ).toBe('CONTROL_CHARACTER');
    });
  });

  describe('measuring', () => {
    /**
     * The reason the bound is in codepoints. Measured in UTF-16 units an
     * astral character counts twice, so a name of emoji would be refused at
     * half the stated length.
     */
    it('counts an astral character once', () => {
      expect(countCodepoints('🖖')).toBe(1);
      expect('🖖'.length).toBe(2);
      expect(isValidExactGameName('🖖'.repeat(64))).toBe(true);
      expect(isValidExactGameName('🖖'.repeat(65))).toBe(false);
    });

    it('counts an edge space against the bound', () => {
      expect(
        isValidExactGameName(`${'a'.repeat(EXACT_GAME_NAME_MAX_CODEPOINTS)} `),
      ).toBe(false);
    });

    it('forbids the two control ranges and nothing else', () => {
      expect(EXACT_GAME_NAME_FORBIDDEN_PATTERN.test('\u001F')).toBe(true);
      expect(EXACT_GAME_NAME_FORBIDDEN_PATTERN.test('\u0020')).toBe(false);
      expect(EXACT_GAME_NAME_FORBIDDEN_PATTERN.test('\u007E')).toBe(false);
      expect(EXACT_GAME_NAME_FORBIDDEN_PATTERN.test('\u009F')).toBe(true);
      expect(EXACT_GAME_NAME_FORBIDDEN_PATTERN.test('\u00A0')).toBe(false);
    });
  });

  describe('the two normal forms, which answer different questions', () => {
    /** The same name composed two ways: precomposed é, and e plus a combining accent. */
    const PRECOMPOSED = 'Fl\u00E9otte Omega';
    const DECOMPOSED = 'Fle\u0301otte Omega';

    it('matches the same name composed either way', () => {
      expect(PRECOMPOSED).not.toBe(DECOMPOSED);
      expect(toComparableExactGameName(PRECOMPOSED)).toBe(
        toComparableExactGameName(DECOMPOSED),
      );
    });

    it('leaves case and spacing alone when comparing to a filename', () => {
      expect(toComparableExactGameName(' Omega Armada ')).not.toBe(
        toComparableExactGameName('omega armada'),
      );
    });

    it('folds case when looking for a duplicate', () => {
      expect(toNormalisedExactGameName('OMEGA ARMADA')).toBe('omega armada');
      expect(toNormalisedExactGameName(DECOMPOSED)).toBe(
        toNormalisedExactGameName(PRECOMPOSED.toUpperCase()),
      );
    });

    /**
     * Steve has seen a leading space used in game precisely so that two
     * different Fleets can carry almost the same name. Folding it away would
     * make the directory tell a registrant a Fleet already exists when what
     * exists is a deliberately distinct one, and a confident wrong warning is
     * what stops people trusting the warning at all.
     */
    it('keeps an edge space, which may be the whole difference', () => {
      expect(toNormalisedExactGameName(' Omega Armada')).toBe(' omega armada');
      expect(toNormalisedExactGameName(' Omega Armada')).not.toBe(
        toNormalisedExactGameName('Omega Armada'),
      );
      expect(toNormalisedExactGameName('Omega Armada ')).not.toBe(
        toNormalisedExactGameName('Omega Armada'),
      );
    });

    /**
     * Punctuation is not folded. `.Darkstar Command.` and `Darkstar Command`
     * are two labels in the corpus and there is no evidence they are one
     * Fleet, so the duplicate warning must not claim they are.
     */
    it('does not fold punctuation away', () => {
      expect(toNormalisedExactGameName('.Darkstar Command.')).not.toBe(
        toNormalisedExactGameName('Darkstar Command'),
      );
      expect(toNormalisedExactGameName('« Omega Armada »')).not.toBe(
        toNormalisedExactGameName('Omega Armada'),
      );
    });
  });
});
