import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformLauncherService } from './platform-launcher.service';

@ApiTags('STO Account APIs')
@Controller('platform-launcher')
export class PlatformLauncherController {
  constructor(
    private readonly platformLauncherService: PlatformLauncherService,
  ) {}

  @Get()
  findAll() {
    return this.platformLauncherService.findAll();
  }
}
