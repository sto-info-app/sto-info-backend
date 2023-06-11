import { Module } from '@nestjs/common';
import { LauncherService } from './launcher.service';
import { LauncherController } from './launcher.controller';

@Module({
  controllers: [LauncherController],
  providers: [LauncherService]
})
export class LauncherModule {}
