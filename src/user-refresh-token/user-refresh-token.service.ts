import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { Repository } from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';
import { CreateUserRefreshTokenDto } from './dto/create-user-refresh-token.dto';
import { UserRefreshTokenEntity } from './entities/user-refresh-token.entity';

@Injectable()
export class UserRefreshTokenService {
  /**
   * Creates an instance of UserRefreshTokenService.
   *
   * @param _refreshTokenRepository - The refresh token repository.
   * @param _configService - The config service.
   * @param _secretsService - The secrets service.
   */
  constructor(
    @InjectRepository(UserRefreshTokenEntity)
    private readonly _refreshTokenRepository: Repository<UserRefreshTokenEntity>,
    private readonly _configService: ConfigService,
    private readonly _secretsService: SecretsService,
  ) {}

  /**
   * Verified and decodes a raw refresh token using the JWT secret.
   *
   * @param rawRefreshToken - The raw refresh token string.
   * @returns A promise that resolves to the decoded JWT payload.
   * @throws UnauthorizedException if verification fails or secrets are missing.
   */
  private async verifyAndDecodeRefreshToken(
    rawRefreshToken: string,
  ): Promise<jwt.JwtPayload> {
    const secretName = this._configService.get<string>('AWS_SECRET_NAME');
    if (!secretName) {
      throw new UnauthorizedException('Refresh token verification unavailable');
    }

    const secretObject = await this._secretsService.getSecret(secretName);
    if (!secretObject?.jwtSecret) {
      throw new UnauthorizedException('Refresh token verification unavailable');
    }

    const verified = jwt.verify(rawRefreshToken, secretObject.jwtSecret, {
      algorithms: ['HS256'],
      clockTolerance: 30,
    });

    if (!verified || typeof verified === 'string') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return verified;
  }

  /**
   * Create a new refresh token record in the database.
   *
   * @param refreshTokenDto - Data for the new refresh token.
   * @returns A promise that resolves to the saved UserRefreshTokenEntity.
   * @throws BadRequestException if data is missing.
   */
  async create(
    refreshTokenDto: CreateUserRefreshTokenDto,
  ): Promise<UserRefreshTokenEntity> {
    if (!refreshTokenDto) {
      throw new BadRequestException('Refresh token data is required');
    }

    const refreshToken = this._refreshTokenRepository.create(refreshTokenDto);

    // If we have a raw token string in tokenId, we hash it for storage
    // However, we should prefer using jwtId (JTI) for identification
    if (refreshToken.tokenId) {
      refreshToken.tokenId = await bcrypt.hash(
        refreshToken.tokenId,
        +process.env.AUTH_SALT_ROUNDS!,
      );
    }

    // Set the expiresAt value to AUTH_REFRESH_TOKEN_EXPIRES_IN seconds from now
    const expiresAt = new Date();
    expiresAt.setSeconds(
      expiresAt.getSeconds() +
        Number(process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN),
    );

    refreshToken.expiresAt = expiresAt;

    return this._refreshTokenRepository.save(refreshToken);
  }

  /**
   * Find a refresh token record by its hashed token ID.
   *
   * @param tokenId - The hashed token value.
   * @returns A promise that resolves to the UserRefreshTokenEntity or null if not found.
   * @throws BadRequestException if the Token ID is missing.
   */
  async findByTokenId(tokenId: string): Promise<UserRefreshTokenEntity | null> {
    if (!tokenId) {
      throw new BadRequestException('Token ID is required');
    }

    return await this._refreshTokenRepository.findOne({
      where: { tokenId: tokenId },
    });
  }

  /**
   * Creates and persists a new refresh token for a specific user.
   *
   * @param user - The user entity for whom to create the token.
   * @param refreshToken - The raw JWT refresh token string.
   * @returns A promise that resolves to the saved UserRefreshTokenEntity.
   * @throws BadRequestException if parameters are missing or the token is invalid.
   */
  async createUserRefreshToken(
    user: UserEntity,
    refreshToken: string,
  ): Promise<UserRefreshTokenEntity> {
    if (!user) {
      throw new BadRequestException('User is required');
    }

    if (!refreshToken) {
      throw new BadRequestException('Refresh token is required');
    }

    const refreshTokenEntity = new UserRefreshTokenEntity();
    refreshTokenEntity.user = user;
    refreshTokenEntity.userId = user.id;

    let refreshTokenPayload: jwt.JwtPayload;
    try {
      refreshTokenPayload =
        await this.verifyAndDecodeRefreshToken(refreshToken);
    } catch (err) {
      throw new BadRequestException('Invalid refresh token', {
        cause: err as Error,
      });
    }

    if (refreshTokenPayload.jti) {
      refreshTokenEntity.jwtId = refreshTokenPayload.jti;
    }

    // Set the expiresAt value from the token itself or environment
    const expiresAt = new Date();
    if (refreshTokenPayload.exp) {
      expiresAt.setTime(refreshTokenPayload.exp * 1000);
    } else {
      expiresAt.setSeconds(
        expiresAt.getSeconds() +
          Number(process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN),
      );
    }
    refreshTokenEntity.expiresAt = expiresAt;

    // We can also store a hash of the raw token if we want extra validation
    refreshTokenEntity.tokenId = await bcrypt.hash(
      refreshToken,
      +process.env.AUTH_SALT_ROUNDS!,
    );

    return await this._refreshTokenRepository.save(refreshTokenEntity);
  }

  /**
   * Revokes a user's refresh token by marking it as revoked in the database.
   *
   * @param rawRefreshToken - The raw refresh token string to be revoked
   * @returns A promise that resolves when the token has been successfully revoked
   */
  async revokeUserRefreshToken(rawRefreshToken: string): Promise<void> {
    if (!rawRefreshToken) {
      throw new BadRequestException('Refresh token is required');
    }

    let payload: jwt.JwtPayload;
    try {
      payload = await this.verifyAndDecodeRefreshToken(rawRefreshToken);
    } catch {
      // Best-effort revoke: if the token is invalid/expired we can't reliably identify the JTI.
      return;
    }

    if (!payload.jti) {
      return;
    }

    await this._refreshTokenRepository.update(
      { jwtId: payload.jti, isRevoked: false },
      { isRevoked: true },
    );
  }

  /**
   * Revokes a specific token for a user.
   *
   * @param userId - The ID of the user
   * @param rawRefreshToken - The raw refresh token string to be revoked
   */
  async revokeToken(userId: string, rawRefreshToken: string): Promise<void> {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    if (!rawRefreshToken) {
      throw new BadRequestException('Refresh token is required');
    }

    let payload: jwt.JwtPayload;
    try {
      payload = await this.verifyAndDecodeRefreshToken(rawRefreshToken);
    } catch (err) {
      throw new UnauthorizedException('Invalid refresh token', {
        cause: err as Error,
      });
    }

    if (!payload.jti) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenRecord = await this._refreshTokenRepository.findOne({
      where: { jwtId: payload.jti, userId: userId },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Refresh token does not exist');
    }

    // Mark as revoked
    tokenRecord.isRevoked = true;
    await this._refreshTokenRepository.save(tokenRecord);
  }

  /**
   * Revokes all refresh tokens for a given user by
   * marking their records as revoked in the database.
   *
   * This is useful when we want to perform a full
   * logout across all devices/sessions for security
   * reasons (for example after a password reset
   * or suspicious activity).
   */
  async revokeAllTokensForUser(userId: string): Promise<void> {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    await this._refreshTokenRepository.update(
      { userId, isRevoked: false },
      { isRevoked: true },
    );

    // Clear persisted refresh tokens so all active sessions are forced to re-authenticate.
    await this._refreshTokenRepository.delete({ userId });
  }

  /**
   * Background task to clean up expired or revoked tokens from the database.
   *
   * @returns A promise that resolves when the cleanup is complete.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredAndRevokedTokens(): Promise<void> {
    const now = new Date();

    await this._refreshTokenRepository
      .createQueryBuilder()
      .delete()
      .where('expiresAt < :now OR isRevoked = :revoked', { now, revoked: true })
      .execute();
  }
}
