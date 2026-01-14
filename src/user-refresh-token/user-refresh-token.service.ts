import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { Repository } from 'typeorm';

import { UserEntity } from 'src/user/entities/user.entity';
import { CreateUserRefreshTokenDto } from './dto/create-user-refresh-token.dto';
import { UserRefreshTokenEntity } from './entities/user-refresh-token.entity';

@Injectable()
export class UserRefreshTokenService {
  constructor(
    @InjectRepository(UserRefreshTokenEntity)
    private readonly refreshTokenRepository: Repository<UserRefreshTokenEntity>,
  ) {}

  async create(
    refreshTokenDto: CreateUserRefreshTokenDto,
  ): Promise<UserRefreshTokenEntity> {
    const refreshToken = this.refreshTokenRepository.create(refreshTokenDto);

    // If we have a raw token string in tokenId, we hash it for storage
    // However, we should prefer using jwtId (JTI) for identification
    if (refreshToken.tokenId) {
      refreshToken.tokenId = await bcrypt.hash(
        refreshToken.tokenId,
        +process.env.AUTH_SALT_ROUNDS,
      );
    }

    // Set the expiresAt value to AUTH_REFRESH_TOKEN_EXPIRES_IN seconds from now
    const expiresAt = new Date();
    expiresAt.setSeconds(
      expiresAt.getSeconds() +
        Number(process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN),
    );

    refreshToken.expiresAt = expiresAt;

    return this.refreshTokenRepository.save(refreshToken);
  }

  async findByTokenId(tokenId: string): Promise<UserRefreshTokenEntity | null> {
    return await this.refreshTokenRepository.findOne({
      where: { tokenId: tokenId },
    });
  }

  async createUserRefreshToken(
    user: UserEntity,
    refreshToken: string,
  ): Promise<UserRefreshTokenEntity> {
    const refreshTokenEntity = new UserRefreshTokenEntity();
    refreshTokenEntity.user = user;
    refreshTokenEntity.userId = user.id;

    // Parse the JWT to extract the jti claim
    const refreshTokenPayload = jwt.decode(refreshToken) as jwt.JwtPayload;
    if (refreshTokenPayload?.jti) {
      refreshTokenEntity.jwtId = refreshTokenPayload.jti;
    }

    // Set the expiresAt value from the token itself or environment
    const expiresAt = new Date();
    if (refreshTokenPayload?.exp) {
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
      +process.env.AUTH_SALT_ROUNDS,
    );

    return await this.refreshTokenRepository.save(refreshTokenEntity);
  }

  /**
   * Revokes a user's refresh token by marking it as revoked in the database.
   *
   * @param rawRefreshToken - The raw refresh token string to be revoked
   * @returns A promise that resolves when the token has been successfully revoked
   */
  async revokeUserRefreshToken(rawRefreshToken: string): Promise<void> {
    // Decode the token to get the JTI
    const payload = jwt.decode(rawRefreshToken) as jwt.JwtPayload;
    if (!payload?.jti) {
      return;
    }

    await this.refreshTokenRepository.update(
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
    // Decode the token to get the JTI
    const payload = jwt.decode(rawRefreshToken) as jwt.JwtPayload;

    if (!payload?.jti) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenRecord = await this.refreshTokenRepository.findOne({
      where: { jwtId: payload.jti, userId: userId },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Refresh token does not exist');
    }

    // Mark as revoked
    tokenRecord.isRevoked = true;
    await this.refreshTokenRepository.save(tokenRecord);
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
    await this.refreshTokenRepository.update(
      { user: { id: userId }, isRevoked: false },
      { isRevoked: true },
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredAndRevokedTokens(): Promise<void> {
    const now = new Date();

    await this.refreshTokenRepository
      .createQueryBuilder()
      .delete()
      .where('expiresAt < :now OR isRevoked = :revoked', { now, revoked: true })
      .execute();
  }
}
