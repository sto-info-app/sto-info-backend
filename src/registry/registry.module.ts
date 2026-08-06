import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { AccountEntity } from '../sto/account/entities/account.entity';
import { CharacterEntity } from '../sto/character/entities/character.entity';
import { PlatformLauncherEntity } from '../sto/platform-launcher/entities/platform-launcher.entity';
import { RegistryController } from './registry.controller';
import { RegistryService } from './registry.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserProfileEntity,
      AccountEntity,
      CharacterEntity,
      PlatformLauncherEntity,
    ]),
  ],
  controllers: [RegistryController],
  providers: [RegistryService],
  exports: [RegistryService],
})
export class RegistryModule {}
