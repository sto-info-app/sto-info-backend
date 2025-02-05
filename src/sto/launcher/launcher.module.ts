import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LauncherEntity } from './entities/launcher.entity';
import { LauncherController } from './launcher.controller';
import { LauncherService } from './launcher.service';

@Module({
  imports: [TypeOrmModule.forFeature([LauncherEntity])],
  controllers: [LauncherController],
  providers: [LauncherService],
  exports: [LauncherService],
})
export class LauncherModule {}
