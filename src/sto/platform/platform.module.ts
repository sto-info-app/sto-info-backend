import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Platform } from './entities/platform.entity';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [TypeOrmModule.forFeature([Platform])],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
