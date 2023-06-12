import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformLauncher } from './entities/platform-launcher.entity';
import { PlatformLauncherController } from './platform-launcher.controller';
import { PlatformLauncherService } from './platform-launcher.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformLauncher])],
  controllers: [PlatformLauncherController],
  providers: [PlatformLauncherService],
  exports: [PlatformLauncherService],
})
export class PlatformLauncherModule {}
