import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserRefreshTokenEntity } from './entities/user-refresh-token.entity';
import { UserRefreshTokenService } from './user-refresh-token.service';

@Module({
  imports: [
    SharedModule,
    TypeOrmModule.forFeature([UserRefreshTokenEntity, UserEntity]),
  ],
  controllers: [],
  providers: [UserRefreshTokenService],
  exports: [UserRefreshTokenService],
})
export class UserRefreshTokenModule {}
