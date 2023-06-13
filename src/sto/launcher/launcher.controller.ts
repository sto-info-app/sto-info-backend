import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LauncherService } from './launcher.service';

@ApiTags('STO Account APIs')
@Controller('launcher')
export class LauncherController {
  constructor(private readonly launcherService: LauncherService) {}

  @Get()
  findAll() {
    return this.launcherService.findAll();
  }
}
