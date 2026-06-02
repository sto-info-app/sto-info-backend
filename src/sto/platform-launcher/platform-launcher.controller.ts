import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformLauncherService } from './platform-launcher.service';

@ApiTags('STO Account APIs')
@Controller('platform-launcher')
export class PlatformLauncherController {
  /**
   * Creates an instance of PlatformLauncherController.
   *
   * @param platformLauncherService - The platform launcher service.
   */
  constructor(
    private readonly platformLauncherService: PlatformLauncherService,
  ) {}

  @Get()
  /**
   * Finds all.
   *
   * @returns The result of the operation.
   */
  findAll() {
    return this.platformLauncherService.findAll();
  }
}
