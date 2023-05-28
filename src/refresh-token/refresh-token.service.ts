import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/user/entities/user.entity';
import { Repository } from 'typeorm';
import { CreateRefreshTokenDto } from './dto/create-refresh-token.dto';
import { RefreshToken } from './entities/refresh-token.entity';

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
  ) {}

  async create(refreshTokenDto: CreateRefreshTokenDto): Promise<RefreshToken> {
    const refreshToken = this.refreshTokenRepository.create(refreshTokenDto);

    // Set the expiresAt value to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    refreshToken.expiresAt = expiresAt;

    return this.refreshTokenRepository.save(refreshToken);
  }

  async findByTokenId(tokenId: string): Promise<RefreshToken | null> {
    return await this.refreshTokenRepository.findOne({
      where: { tokenId: tokenId },
    });
  }

  async createRefreshToken(user: User, tokenId: string): Promise<RefreshToken> {
    const refreshToken = new RefreshToken();
    refreshToken.user = user;
    refreshToken.tokenId = tokenId;

    return await this.refreshTokenRepository.save(refreshToken);
  }

  async deleteRefreshToken(tokenId: string): Promise<void> {
    const refreshToken = await this.findByTokenId(tokenId);

    if (refreshToken) {
      await this.refreshTokenRepository.delete(refreshToken.id);
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
}
