import { Module } from '@nestjs/common';
import { PlatformLauncherService } from './platform-launcher.service';
import { PlatformLauncherController } from './platform-launcher.controller';

@Module({
  controllers: [PlatformLauncherController],
  providers: [PlatformLauncherService]
})
export class PlatformLauncherModule {}
