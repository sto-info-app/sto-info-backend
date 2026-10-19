import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FileAssetsModule } from 'src/file-assets/file-assets.module';
import { PersonalPictureWithdrawalService } from 'src/user/images/personal-picture-withdrawal.service';

import { PlatformLauncherEntity } from '../platform-launcher/entities/platform-launcher.entity';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AccountEntity } from './entities/account.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccountEntity, PlatformLauncherEntity]),
    // Deleting an account withdraws its Characters' portraits.
    FileAssetsModule,
  ],
  controllers: [AccountController],
  providers: [AccountService, PersonalPictureWithdrawalService],
  exports: [AccountService],
})
export class AccountModule {}
