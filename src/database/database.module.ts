import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LauncherEntity } from 'src/sto/launcher/entities/launcher.entity';
import { LauncherModule } from 'src/sto/launcher/launcher.module';
import { PlatformLauncherEntity } from 'src/sto/platform-launcher/entities/platform-launcher.entity';
import { PlatformLauncherModule } from 'src/sto/platform-launcher/platform-launcher.module';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';
import { PlatformModule } from 'src/sto/platform/platform.module';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserModule } from 'src/user/user.module';
import { AccountSeederService } from './account-seeder/account-seeder.service';
import { DatabaseService } from './database.service';
import { UserSeederService } from './user-seeder/user-seeder.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlatformEntity,
      LauncherEntity,
      PlatformLauncherEntity,
      UserEntity,
      //NOTE: Add other entities used in seeder services
    ]),

    PlatformModule,
    LauncherModule,
    PlatformLauncherModule,
    UserModule,
    //NOTE: Add other modules used in seeder services
  ],
  providers: [
    AccountSeederService,
    UserSeederService,
    DatabaseService,
    //NOTE: Add other seeder services here
  ],
  exports: [
    AccountSeederService,
    UserSeederService,
    DatabaseService,
    //NOTE: Add other seeder services here
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
      Logger.log('Database timezone set successfully.', 'DatabaseModule');
    } catch (error) {
      Logger.error('Failed to set database timezone:', error, 'DatabaseModule');
    }

    try {
      await this.userSeederService.seed();
      Logger.log('User seeding completed successfully.', 'DatabaseModule');
    } catch (error) {
      Logger.error('Failed to seed users:', error, 'DatabaseModule');
    }

    try {
      await this.accountSeederService.seed();
      Logger.log('Account seeding completed successfully.', 'DatabaseModule');
    } catch (error) {
      Logger.error('Failed to seed accounts:', error, 'DatabaseModule');
    }

    //NOTE: Add other seeder function calls here
  }
}
