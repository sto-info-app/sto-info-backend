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
   * Validate UUID against regex pattern.
   * @param uuid UUID to validate.
   * @returns True if UUID is valid, false otherwise.
   */
  validateUuid(uuid: string): boolean {
    const uuidRegex = UUID_PATTERN;
    return uuidRegex.test(uuid);
  }

  /**
   * Validate email address against regex pattern.
   * @param email address to validate.
   * @returns True if email is valid, false otherwise.
   */
  validateEmail(email: string): boolean {
    const emailRegex = EMAIL_PATTERN;
    return emailRegex.test(email);
  }

  /**
   * Validate username against regex pattern.
   * @param username Username to validate.
   * @returns True if username is valid, false otherwise.
   */
  validateUsername(username: string): boolean {
    const usernameRegex = USERNAME_PATTERN;
    return usernameRegex.test(username);
  }

  /**
   * Validate password against regex pattern.
   * @param password Password to validate.
   * @returns True if password is valid, false otherwise.
   */
  validatePassword(password: string): boolean {
    const passwordRegex = PASSWORD_PATTERN;
    return passwordRegex.test(password);
  }
}
