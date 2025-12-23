import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserRefreshTokenEntity } from './entities/user-refresh-token.entity';
import { UserRefreshTokenService } from './user-refresh-token.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([UserRefreshTokenEntity, UserEntity]),
  ],
  controllers: [],
  providers: [UserRefreshTokenService],
  exports: [UserRefreshTokenService],
})
export class UserRefreshTokenModule {}
