import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppSettingEntity } from './entities/app-setting.entity';
import { SettingsService } from './settings.service';

/**
 * Operational settings that can be changed while the site is running.
 *
 * Global because a runtime switch is only useful if any feature can consult it
 * without the module that owns the switch having to know who will ask.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AppSettingEntity])],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
