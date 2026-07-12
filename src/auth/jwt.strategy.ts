import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { instanceToPlain } from 'class-transformer';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ensureError } from 'src/shared/utilities/error.utility';

import { CurrentContextHelper } from 'src/shared/context/current-context.helper';
import { SecretsService } from 'src/shared/secrets/secrets.service';

import { AuthService } from './auth.service';
import { JwtPayloadInterface } from './entities/jwt-payload.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /**
   * Creates an instance of JwtStrategy.
   *
   * @param _authService - The auth service.
   * @param _configService - The config service.
   * @param _secretsService - The secrets service.
   */
  constructor(
    private readonly _authService: AuthService,
    private readonly _configService: ConfigService,
    private readonly _secretsService: SecretsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: (_request, _rawJwtToken, done) => {
        const secretName = this._configService.get<string>('AWS_SECRET_NAME')!;
        this._secretsService
          .getSecret(secretName)
          .then(secretObject => {
            done(null, secretObject.jwtSecret);
          })
          .catch((error: unknown) => {
            done(ensureError(error));
          });
      },
      jsonWebTokenOptions: {
        clockTolerance: 30, // 30 seconds buffer for expiry
      },
    });
  }

  /**
   * Validate the JWT payload.
   * @param payload - The JWT payload to validate.
   * @returns The user object if the payload is valid.
   */
  async validate(payload: JwtPayloadInterface) {
    const user = await this._authService.validateUserFromPayload(payload);
    if (!user) {
      throw new UnauthorizedException();
    }

    if (!CurrentContextHelper.userUuid) {
      // Store user UUID for audit logging and downstream usage
      CurrentContextHelper.userUuid = payload.sub;
    }

    return instanceToPlain(user);
  }
}
