import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import {
  EXACT_GAME_NAME_MAX_CODEPOINTS,
  EXACT_GAME_NAME_MIN_CODEPOINTS,
} from '../constants/fleet-name.constants';
import {
  findExactGameNameProblem,
  isValidExactGameName,
} from './exact-game-name.utility';

/**
 * Requires a Fleet or Armada name to be one STO Info will hold — ADR-0003.
 *
 * `@Length` and `@Matches` between them cannot express this. The bound is in
 * codepoints rather than UTF-16 units, and the character rule is an exclusion
 * of two control ranges rather than a pattern of what is allowed, which is
 * the whole point of the decision: a name the game permits and this app has
 * never seen has to get in.
 */
@ValidatorConstraint({ name: 'isExactGameName', async: false })
export class IsExactGameNameConstraint implements ValidatorConstraintInterface {
  /**
   * Determines whether the value is an acceptable exact game name.
   *
   * @param value - The value supplied.
   * @returns True when the name is acceptable.
   */
  validate(value: unknown): boolean {
    return isValidExactGameName(value);
  }

  /**
   * Describes the failure to whoever sent the request.
   *
   * Says which rule was broken. "Invalid name" tells a registrant nothing
   * about a name they can see is perfectly ordinary, and the answer is
   * usually that they pasted something with a stray newline in it.
   *
   * @param args - The property being validated and its value.
   * @returns The message.
   */
  defaultMessage(args: ValidationArguments): string {
    const problem =
      typeof args.value === 'string'
        ? findExactGameNameProblem(args.value)
        : null;

    if (problem === 'TOO_LONG') {
      return `${args.property} must be at most ${EXACT_GAME_NAME_MAX_CODEPOINTS} characters.`;
    }

    if (problem === 'CONTROL_CHARACTER') {
      return `${args.property} must not contain control characters, line breaks or tabs.`;
    }

    return `${args.property} must be at least ${EXACT_GAME_NAME_MIN_CODEPOINTS} character that is not a space.`;
  }
}
