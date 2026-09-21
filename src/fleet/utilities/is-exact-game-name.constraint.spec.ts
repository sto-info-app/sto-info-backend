import { ValidationArguments } from 'class-validator';

import { IsExactGameNameConstraint } from './is-exact-game-name.constraint';

describe('IsExactGameNameConstraint', () => {
  const constraint = new IsExactGameNameConstraint();

  const argsFor = (value: unknown): ValidationArguments =>
    ({
      property: 'exactGameName',
      value,
    }) as ValidationArguments;

  it('accepts a name from the corpus', () => {
    expect(constraint.validate('« Omega Armada »')).toBe(true);
  });

  it('refuses a name with a line break in it', () => {
    expect(constraint.validate('Omega\nArmada')).toBe(false);
  });

  it('refuses a value that is not a string', () => {
    expect(constraint.validate(42)).toBe(false);
  });

  /**
   * The message names the rule that was broken. "Invalid name" tells a
   * registrant nothing about a name they can see is perfectly ordinary, and
   * the usual cause is a value pasted with a stray newline in it.
   */
  it('says the name is too long when it is', () => {
    expect(constraint.defaultMessage(argsFor('a'.repeat(65)))).toBe(
      'exactGameName must be at most 64 characters.',
    );
  });

  it('says what is wrong with a control character', () => {
    expect(constraint.defaultMessage(argsFor('Omega\tArmada'))).toBe(
      'exactGameName must not contain control characters, line breaks or tabs.',
    );
  });

  it('asks for something that is not a space when given nothing else', () => {
    expect(constraint.defaultMessage(argsFor('   '))).toBe(
      'exactGameName must be at least 1 character that is not a space.',
    );
  });

  /**
   * A non-string never reaches `findExactGameNameProblem`, which takes a
   * string. The message still has to say something, and the shortest true
   * thing to say is what a name has to be.
   */
  it('falls back to the same message for a value of the wrong type', () => {
    expect(constraint.defaultMessage(argsFor(42))).toBe(
      'exactGameName must be at least 1 character that is not a space.',
    );
  });
});
