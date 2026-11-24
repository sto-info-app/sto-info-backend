import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { NotificationEmailType } from '../../notification/email/notification-email-type.enum';

const TYPES = new Set<string>(Object.values(NotificationEmailType));

/**
 * Requires email switches to be an object of known types, each true or false
 * (sc-1067).
 */
@ValidatorConstraint({ name: 'isEmailSwitches', async: false })
export class IsEmailSwitchesConstraint implements ValidatorConstraintInterface {
  /**
   * Determines whether the value is a set of email switches.
   *
   * @param value - The value supplied.
   * @returns True when every key is a type and every value a boolean.
   */
  validate(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }

    return Object.entries(value).every(
      ([type, enabled]) => TYPES.has(type) && typeof enabled === 'boolean',
    );
  }

  /**
   * Describes the failure to whoever sent the request.
   *
   * @param args - The property being validated.
   * @returns The message.
   */
  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must map notification email types to true or false.`;
  }
}
