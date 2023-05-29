import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/user/entities/user.entity';
import { UserRefreshToken } from './entities/user-refresh-token.entity';
import { UserRefreshTokenController } from './user-refresh-token.controller';
import { UserRefreshTokenService } from './user-refresh-token.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserRefreshToken, User])],
  controllers: [UserRefreshTokenController],
  providers: [UserRefreshTokenService],
  exports: [UserRefreshTokenService],
})
export class UserRefreshTokenModule {}
