import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/user/entities/user.entity';
import { Repository } from 'typeorm';
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

    // Set the expiresAt value to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

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
    tokenId: string,
  ): Promise<UserRefreshToken> {
    const refreshToken = new UserRefreshToken();
    refreshToken.user = user;
    refreshToken.tokenId = tokenId;

    return await this.refreshTokenRepository.save(refreshToken);
  }

  async deleteUserRefreshToken(tokenId: string): Promise<void> {
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
