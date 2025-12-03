import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { CurrentContextHelper } from 'src/shared/context/current-context.helper';
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
    // Always capture IP for audit logging
    CurrentContextHelper.ip = req.ip || null;

    if (!this.isUserUuidSet()) {
      const token = this.extractToken(req);
      if (token) {
        await this.verifyAndSetUserUuid(token, req);
      }
    }

    next();
  }

  /**
   * Checks if the user UUID is already set in the request context.
   * @returns True if the user UUID is already set in the request context, false otherwise.
   */
  private isUserUuidSet(): boolean {
    return !!CurrentContextHelper.userUuid;
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
  private async verifyAndSetUserUuid(
    token: string,
    req: Request,
  ): Promise<void> {
    try {
      const secretObject = await this.secretsService.getSecret(
        this.configService.get('AWS_SECRET_NAME'),
      );
      if (secretObject?.jwtSecret) {
        const decoded = jwt.verify(token, secretObject.jwtSecret) as JwtPayload;
        const userUuid = decoded.sub;

        // Store in CLS
        CurrentContextHelper.userUuid = userUuid;

        // Also attach to the request for any code that still reads from req
        (req as any).userUuid = userUuid;
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
