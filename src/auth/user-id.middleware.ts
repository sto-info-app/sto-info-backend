import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { RequestContext } from 'nestjs-request-context';
import { SecretsService } from 'src/shared/secrets/secrets.service';

interface JwtPayload {
  sub: string;
  [key: string]: any;
}

/**
 * Middleware to extract user ID from JWT token and set it in the request context.
 * This middleware checks the authorization header for a Bearer token, verifies it,
 * and sets the user ID in the request context for further use, such as audit logging.
 */
@Injectable()
export class UserIdMiddleware implements NestMiddleware {
  constructor(
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
  ) {}

  /**
   * Middleware function to process the incoming request.
   * @param req - The incoming request object.
   * @param _res - The response object (not used).
   * @param next - The next middleware function in the stack.
   */
  async use(req: Request, _res: Response, next: NextFunction) {
    // Check if userUuid is already set in the request context
    if (!RequestContext?.currentContext?.req?.userUuid) {
      const authHeader = req.headers?.authorization;
      // Check if the authorization header starts with 'Bearer '
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        if (!token) {
          return next();
        }

        try {
          // Retrieve the JWT secret from the secrets service
          const secretObject = await this.secretsService.getSecret(
            this.configService.get('AWS_SECRET_NAME'),
          );
          if (secretObject?.jwtSecret) {
            // Verify the token using the JWT secret
            const decoded = jwt.verify(
              token,
              secretObject.jwtSecret,
            ) as JwtPayload;

            // Set the user ID in the request context - this will be used by the RequestContextMiddleware for audit logging
            RequestContext.currentContext.req.userUuid = decoded.sub;
          } else {
            console.error('Secret object or jwtSecret is undefined');
          }
        } catch (err) {
          console.error('Invalid token:', err);
        }
      }
    }
    next();
  }
}
