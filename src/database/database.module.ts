import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Launcher } from 'src/sto/launcher/entities/launcher.entity';
import { LauncherModule } from 'src/sto/launcher/launcher.module';
import { PlatformLauncher } from 'src/sto/platform-launcher/entities/platform-launcher.entity';
import { PlatformLauncherModule } from 'src/sto/platform-launcher/platform-launcher.module';
import { Platform } from 'src/sto/platform/entities/platform.entity';
import { PlatformModule } from 'src/sto/platform/platform.module';
import { User } from 'src/user/entities/user.entity';
import { UserModule } from 'src/user/user.module';
import { AccountSeederService } from './account-seeder/account-seeder.service';
import { DatabaseService } from './database.service';
import { UserSeederService } from './user-seeder/user-seeder.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Platform,
      Launcher,
      PlatformLauncher,
      User,
      //TODO: Add other entities used in seeder services
    ]),

    PlatformModule,
    LauncherModule,
    PlatformLauncherModule,
    UserModule,
    //TODO: Add other modules used in seeder services
  ],
  providers: [
    AccountSeederService,
    UserSeederService,
    DatabaseService,
    //TODO: Add other seeder services here
  ],
  exports: [
    AccountSeederService,
    UserSeederService,
    DatabaseService,
    //TODO: Add other seeder services here
  ],
})
export class DatabaseModule implements OnModuleInit {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly userSeederService: UserSeederService,
    private readonly accountSeederService: AccountSeederService,
  ) {}

  async onModuleInit() {
    try {
      await this.databaseService.setDatabaseTimezone();
      console.info('Database timezone set successfully.');
    } catch (error) {
      console.error('Failed to set database timezone:', error);
    }

    try {
      await this.userSeederService.seed();
      console.info('User seeding completed successfully.');
    } catch (error) {
      console.error('Failed to seed users:', error);
    }

    try {
      await this.accountSeederService.seed();
      console.info('Account seeding completed successfully.');
    } catch (error) {
      console.error('Failed to seed accounts:', error);
    }

    //TODO: Add other seeder function calls here
  }
}
