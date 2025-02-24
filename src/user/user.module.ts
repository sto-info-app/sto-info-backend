import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';
import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { UserProfileEntity } from './entities/user-profile.entity';
import { UserEntity } from './entities/user.entity';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [
    SharedModule,
    TypeOrmModule.forFeature([UserEntity, UserProfileEntity]),
  ],
  controllers: [UserController],
  providers: [UserService, ValidatorsService, ImageUploadsService, S3Client],
  exports: [UserService, TypeOrmModule],
})
export class UserModule {}
