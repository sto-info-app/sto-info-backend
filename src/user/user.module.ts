import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/auth/auth.module';
import { SharedModule } from 'src/shared/shared.module';
import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { UserProfileEntity } from './entities/user-profile.entity';
import { UserEntity } from './entities/user.entity';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [
    SharedModule,
    TypeOrmModule.forFeature([UserEntity, UserProfileEntity]),
    forwardRef(() => AuthModule), // Use forwardRef to handle circular dependency
  ],
  controllers: [UserController],
  providers: [UserService, ValidatorsService],
  exports: [UserService, TypeOrmModule],
})
export class UserModule {}
