import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import * as jwt from 'jsonwebtoken';
import { Repository } from 'typeorm';

import { User } from 'src/user/entities/user.entity';
import { CreateUserRefreshTokenDto } from './dto/create-user-refresh-token.dto';
import { UserRefreshToken } from './entities/user-refresh-token.entity';

@Injectable()
export class UserRefreshTokenService {
  constructor(
    @InjectRepository(UserRefreshToken)
    private refreshTokenRepository: Repository<UserRefreshToken>,
  ) {}

  async create(
    refreshTokenDto: CreateUserRefreshTokenDto,
  ): Promise<UserRefreshToken> {
    const refreshToken = this.refreshTokenRepository.create(refreshTokenDto);

    // Set the expiresAt value to AUTH_REFRESH_TOKEN_EXPIRES_IN seconds from now
    const expiresAt = new Date();
    expiresAt.setSeconds(
      expiresAt.getSeconds() +
        Number(process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN),
    );

    refreshToken.expiresAt = expiresAt;

    return this.refreshTokenRepository.save(refreshToken);
  }

  async findByTokenId(tokenId: string): Promise<UserRefreshToken | null> {
    return await this.refreshTokenRepository.findOne({
      where: { tokenId: tokenId },
    });
  }

  async createUserRefreshToken(
    user: User,
    refreshToken: string,
  ): Promise<UserRefreshToken> {
    const refreshTokenEntity = new UserRefreshToken();
    refreshTokenEntity.user = user;

    // Parse the JWT to extract the jti claim
    const refreshTokenPayload = jwt.decode(refreshToken) as jwt.JwtPayload;
    if (refreshTokenPayload.jti) {
      refreshTokenEntity.tokenId = refreshTokenPayload.jti;
    }

    return await this.refreshTokenRepository.save(refreshTokenEntity);
  }

  async revokeUserRefreshToken(tokenId: string): Promise<void> {
    const tokenRecord = await this.refreshTokenRepository.findOne({
      where: { tokenId: tokenId },
    });

    if (tokenRecord) {
      tokenRecord.isRevoked = true;
      await this.refreshTokenRepository.save(tokenRecord);
    }
  }

  async revokeToken(userId: string, tokenId: string): Promise<void> {
    // Getting the refresh token
    const tokenRecord = await this.refreshTokenRepository.findOne({
      where: { tokenId: tokenId },
      relations: ['user'], // This will join the related User entity
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Refresh token does not exist');
    }

    // Check the User ID
    if (tokenRecord.user.id !== userId) {
      throw new UnauthorizedException('Refresh token does not match the user');
    }

    // Updating the refresh token
    tokenRecord.isRevoked = true;
    await this.refreshTokenRepository.save(tokenRecord);
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
