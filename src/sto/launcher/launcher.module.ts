import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Launcher } from './entities/launcher.entity';
import { LauncherController } from './launcher.controller';
import { LauncherService } from './launcher.service';

@Module({
  imports: [TypeOrmModule.forFeature([Launcher])],
  controllers: [LauncherController],
  providers: [LauncherService],
  exports: [LauncherService],
})
export class LauncherModule {}
