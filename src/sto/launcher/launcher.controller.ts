import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LauncherService } from './launcher.service';

@ApiTags('STO Account APIs')
@Controller('launcher')
export class LauncherController {
  /**
   * Creates an instance of LauncherController.
   *
   * @param launcherService - The launcher service.
   */
  constructor(private readonly launcherService: LauncherService) {}

  @Get()
  /**
   * Finds all.
   *
   * @returns The result of the operation.
   */
  findAll() {
    return this.launcherService.findAll();
  }
}
