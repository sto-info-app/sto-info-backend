import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { instanceToPlain } from 'class-transformer';
import { RequestContext } from 'nestjs-request-context';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { AuthService } from './auth.service';
import { JwtPayloadInterface } from './entities/jwt-payload.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: async (_request, _rawJwtToken, done) => {
        try {
          const secretObject = await this.secretsService.getSecret(
            this.configService.get('AWS_SECRET_NAME'),
          );
          done(null, secretObject.jwtSecret);
        } catch (error) {
          done(error, null);
        }
      },
    });
  }

  /**
   * Validate the JWT payload.
   * @param payload - The JWT payload to validate.
   * @returns The user object if the payload is valid.
   */
  async validate(payload: JwtPayloadInterface) {
    const user = await this.authService.validateUserFromPayload(payload);
    if (!user) {
      throw new UnauthorizedException();
    }

    if (!RequestContext?.currentContext?.req?.userUuid) {
      // Set the user ID in the request context - this will be used by the RequestContextMiddleware for audit logging
      RequestContext.currentContext.req.userUuid = payload.sub;
    }

    return instanceToPlain(user);
  }
}
