import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { isCalendarDate } from '../shared/custom-tracking-calendar.utility';

/**
 * Requires a date to be a real day, written as `YYYY-MM-DD`.
 *
 * `@IsDateString` accepts a full instant with an offset, which is the wrong
 * shape for a value that deliberately has no timezone, and it does not object
 * to the thirtieth of February.
 */
@ValidatorConstraint({ name: 'isCalendarDate', async: false })
export class IsCalendarDateConstraint implements ValidatorConstraintInterface {
  /**
   * Determines whether the value is a real calendar date.
   *
   * @param value - The value supplied.
   * @returns True when the string names a day that exists.
   */
  validate(value: unknown): boolean {
    return isCalendarDate(value);
  }

  /**
   * Describes the failure to whoever sent the request.
   *
   * @param args - The property being validated.
   * @returns The message.
   */
  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a date that exists, written as YYYY-MM-DD.`;
  }
}
