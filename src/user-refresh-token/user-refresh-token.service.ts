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

    // Hash the raw refresh token string before storing it
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

    // Parse the JWT to extract the jti claim
    const refreshTokenPayload = jwt.decode(refreshToken) as jwt.JwtPayload;
    if (refreshTokenPayload.jti) {
      refreshTokenEntity.tokenId = refreshTokenPayload.jti;
    }

    return await this.refreshTokenRepository.save(refreshTokenEntity);
  }

  /**
   * Revokes a user's refresh token by marking it as revoked in the database.
   *
   * This method is used by the logout endpoint and receives the raw refresh token string.
   * It finds the matching token record by comparing the raw token against stored hashes
   * using bcrypt, then marks the token as revoked.
   *
   * @param tokenId - The raw refresh token string to be revoked
   * @returns A promise that resolves when the token has been successfully revoked
   *
   * @remarks
   * - This method iterates through all active tokens and compares each hash, which may not be performant for large datasets
   * - If no matching token is found, the method returns silently without throwing an error
   * - The token is marked as revoked rather than deleted, maintaining an audit trail
   */
  async revokeUserRefreshToken(tokenId: string): Promise<void> {
    const tokens = await this.refreshTokenRepository.find({
      where: { isRevoked: false },
    });

    for (const tokenRecord of tokens) {
      const matches = await bcrypt.compare(tokenId, tokenRecord.tokenId);
      if (matches) {
        tokenRecord.isRevoked = true;
        await this.refreshTokenRepository.save(tokenRecord);
        return;
      }
    }
  }

  async revokeToken(userId: string, tokenId: string): Promise<void> {
    // Getting the refresh token: tokenId here is the raw token string.
    const tokens = await this.refreshTokenRepository.find({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    for (const tokenRecord of tokens) {
      const matches = await bcrypt.compare(tokenId, tokenRecord.tokenId);
      if (matches) {
        // Check the User ID (defensive)
        if (tokenRecord.user.id !== userId) {
          throw new UnauthorizedException(
            'Refresh token does not match the user',
          );
        }

        // Updating the refresh token
        tokenRecord.isRevoked = true;
        await this.refreshTokenRepository.save(tokenRecord);
        return;
      }
    }

    throw new UnauthorizedException('Refresh token does not exist');
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
