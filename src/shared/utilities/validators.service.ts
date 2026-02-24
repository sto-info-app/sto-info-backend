import {
  EMAIL_PATTERN,
  PASSWORD_PATTERN,
  USERNAME_PATTERN,
  UUID_PATTERN,
} from '../constants/regex-patterns.constants';

import { Injectable } from '@nestjs/common';

@Injectable()
export class ValidatorsService {
  /**
   * Validates if a string is a correctly formatted UUID.
   *
   * @param uuid - The UUID string to validate.
   * @returns `true` if the UUID is valid; `false` otherwise.
   */
  validateUuid(uuid: string): boolean {
    const uuidRegex = UUID_PATTERN;
    return uuidRegex.test(uuid);
  }

  /**
   * Validates if a string is a correctly formatted email address.
   *
   * @param email - The email address string to validate.
   * @returns `true` if the email is valid; `false` otherwise.
   */
  validateEmail(email: string): boolean {
    const emailRegex = EMAIL_PATTERN;
    return emailRegex.test(email);
  }

  /**
   * Validates if a string is a correctly formatted username.
   *
   * @param username - The username string to validate.
   * @returns `true` if the username is valid; `false` otherwise.
   */
  validateUsername(username: string): boolean {
    const usernameRegex = USERNAME_PATTERN;
    return usernameRegex.test(username);
  }

  /**
   * Validates if a string meets the required password complexity rules.
   *
   * @param password - The password string to validate.
   * @returns `true` if the password is valid; `false` otherwise.
   */
  validatePassword(password: string): boolean {
    const passwordRegex = PASSWORD_PATTERN;
    return passwordRegex.test(password);
  }
}
