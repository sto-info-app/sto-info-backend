import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Launcher } from 'src/sto/launcher/entities/launcher.entity';
import { LauncherModule } from 'src/sto/launcher/launcher.module';
import { PlatformLauncher } from 'src/sto/platform-launcher/entities/platform-launcher.entity';
import { PlatformLauncherModule } from 'src/sto/platform-launcher/platform-launcher.module';
import { Platform } from 'src/sto/platform/entities/platform.entity';
import { PlatformModule } from 'src/sto/platform/platform.module';
import { AccountSeederService } from './account-seeder/account-seeder.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Platform,
      Launcher,
      PlatformLauncher,
      //TODO: Add other entities used in seeder services
    ]),

    PlatformModule,
    LauncherModule,
    PlatformLauncherModule,
    //TODO: Add other modules used in seeder services
  ],
  providers: [
    AccountSeederService,
    //TODO: Add other seeder services here
  ],
  exports: [
    AccountSeederService,
    //TODO: Add other seeder services here
  ],
})
export class DatabaseModule implements OnModuleInit {
  constructor(private readonly accountSeederService: AccountSeederService) {}

  async onModuleInit() {
    await this.accountSeederService.seed();
    //TODO: Add other seeder function calls here
  }
}
