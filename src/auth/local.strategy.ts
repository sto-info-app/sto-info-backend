import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';

import { AuthService } from './auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  /**
   * Creates an instance of LocalStrategy.
   *
   * @param _authService - The auth service.
   */
  constructor(private readonly _authService: AuthService) {
    super({ usernameField: 'email' }); // Use 'email' instead of the default 'username'
  }

  /**
   * Validates the supplied input.
   *
   * @param email - The email.
   * @param password - The password.
   * @returns A promise that resolves when the operation completes.
   */
  async validate(email: string, password: string): Promise<any> {
    const user = await this._authService.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
