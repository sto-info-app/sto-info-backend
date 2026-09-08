import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { isKnownTimezone } from '../shared/custom-tracking-timezone.utility';

/**
 * Requires a timezone to be an IANA identifier this runtime can convert with.
 *
 * Abbreviations are refused. `GMT` and `BST` name the same place at different
 * times of year, so a value recorded against one cannot be converted back to
 * the moment its author meant.
 */
@ValidatorConstraint({ name: 'isIanaTimezone', async: false })
export class IsIanaTimezoneConstraint implements ValidatorConstraintInterface {
  /**
   * Determines whether the value names a usable timezone.
   *
   * @param value - The value supplied.
   * @returns True when it is a known IANA identifier.
   */
  validate(value: unknown): boolean {
    return typeof value === 'string' && isKnownTimezone(value);
  }

  /**
   * Describes the failure to whoever sent the request.
   *
   * @param args - The property being validated.
   * @returns The message.
   */
  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be an IANA timezone such as "Europe/London". Abbreviations like GMT or BST are not accepted, because they do not say whether summer time applies.`;
  }
}
