import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
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
    if (!this.isUserUuidSet()) {
      const token = this.extractToken(req);
      if (token) {
        await this.verifyAndSetUserUuid(token);
      }
    }
    next();
  }

  /**
   * Checks if the user UUID is already set in the request context.
   * @returns True if the user UUID is already set in the request context, false otherwise.
   */
  private isUserUuidSet(): boolean {
    return !!RequestContext?.currentContext?.req?.userUuid;
  }

  /**
   * Extracts the JWT token from the authorization header.
   * @param req - The incoming request object.
   * @returns The JWT token if present, null otherwise.
   */
  private extractToken(req: Request): string | null {
    const authHeader = req.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.split(' ')[1] || null;
    }
    return null;
  }

  /**
   * Verifies the JWT token and sets the user UUID in the request context.
   * @param token - The JWT token to verify.
   */
  private async verifyAndSetUserUuid(token: string): Promise<void> {
    try {
      const secretObject = await this.secretsService.getSecret(
        this.configService.get('AWS_SECRET_NAME'),
      );
      if (secretObject?.jwtSecret) {
        const decoded = jwt.verify(token, secretObject.jwtSecret) as JwtPayload;
        RequestContext.currentContext.req.userUuid = decoded.sub;
      } else {
        Logger.error(
          'Secret object or jwtSecret is undefined',
          'UserIdMiddleware',
        );
      }
    } catch (err) {
      this.handleTokenError(err);
    }
  }

  /**
   * Handles token verification errors.
   * @param err - The error object thrown during token verification.
   */
  private handleTokenError(err: any): void {
    if (err.name === 'TokenExpiredError') {
      Logger.error('Token has expired:', err, 'UserIdMiddleware');
    } else {
      Logger.error('Invalid token:', err, 'UserIdMiddleware');
    }
  }
}
