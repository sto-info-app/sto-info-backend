import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { PlatformLauncherService } from './platform-launcher.service';

@ApiTags('STO Account APIs')
@Controller('platform-launcher')
export class PlatformLauncherController {
  /**
   * Creates an instance of PlatformLauncherController.
   *
   * @param _platformLauncherService - The platform launcher service.
   */
  constructor(
    private readonly _platformLauncherService: PlatformLauncherService,
  ) {}

  @Get()
  /**
   * Finds all.
   *
   * @returns The result of the operation.
   */
  findAll() {
    return this._platformLauncherService.findAll();
  }
}
