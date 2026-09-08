import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { isExactDecimal } from '../shared/custom-tracking-decimal.utility';

/**
 * Requires a decimal to arrive as a string written out in full.
 *
 * `@IsNumber` would be the obvious decorator and is the wrong one. A JSON
 * number is a double, so a figure a user typed exactly has already been
 * rounded by the time any decorator sees it, and the rounding cannot be
 * undone. Insisting on the written form is what lets the value reach
 * PostgreSQL's `numeric` unchanged.
 */
@ValidatorConstraint({ name: 'isExactDecimal', async: false })
export class IsExactDecimalConstraint implements ValidatorConstraintInterface {
  /**
   * Determines whether the value is an acceptable decimal.
   *
   * @param value - The value supplied.
   * @returns True when it is a well-formed decimal within range.
   */
  validate(value: unknown): boolean {
    return isExactDecimal(value);
  }

  /**
   * Describes the failure to whoever sent the request.
   *
   * @param args - The property being validated.
   * @returns The message.
   */
  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a number written out in full, such as "12.5", and sent as text so its exact value is kept.`;
  }
}
