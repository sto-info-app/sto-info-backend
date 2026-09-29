import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { AuthService } from 'src/auth/auth.service';
import { JwtPayloadInterface } from 'src/auth/entities/jwt-payload.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

/** Who a socket belongs to, and until when. */
export interface ChatSocketIdentity {
  readonly userId: string;
  /** Their username, if they have one (FC-034). */
  readonly username: string | null;
  /** When the token it showed runs out, in milliseconds since the epoch. */
  readonly expiresAt: number;
}

/**
 * Says who a chat socket belongs to (FC-032).
 *
 * Steve's decisions of 28 September 2026: the token comes in the socket's
 * first message, never in its address, so it is in no URL and no access log.
 * It is checked as the HTTP API checks it — an access token, signed HS256,
 * for an account that exists and is not disabled — and again whenever the
 * browser sends a fresh one before the old one runs out. Nothing here logs
 * a token.
 */
@Injectable()
export class ChatSocketAuthService {
  /**
   * Creates an instance of ChatSocketAuthService.
   *
   * @param _jwtService - Verifies tokens with the API's own secret.
   * @param _authService - Looks the account up.
   * @param _dataSource - Reads their username.
   */
  constructor(
    private readonly _jwtService: JwtService,
    private readonly _authService: AuthService,
    @InjectDataSource()
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Checks a token a socket showed.
   *
   * @param token - What it sent.
   * @returns Who it belongs to, and until when.
   * @throws UnauthorizedException when it is not a live access token for an
   *   account in use.
   */
  async identify(token: unknown): Promise<ChatSocketIdentity> {
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('Sign in to use chat.');
    }

    let payload: JwtPayloadInterface & { exp?: number };

    try {
      payload = await this._jwtService.verifyAsync(token, {
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Sign in to use chat.');
    }

    if (payload.tokenUse !== 'access' || payload.exp === undefined) {
      throw new UnauthorizedException('Sign in to use chat.');
    }

    const user = await this._authService.validateUserFromPayload(payload);

    if (user === null) {
      throw new UnauthorizedException('Sign in to use chat.');
    }

    const profile = await this._dataSource.manager.findOne(UserProfileEntity, {
      where: { userId: user.id },
      select: { userId: true, username: true },
    });

    return {
      userId: user.id,
      username: profile?.username ?? null,
      expiresAt: payload.exp * 1000,
    };
  }
}
