import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformService } from './platform.service';

@ApiTags('STO Account APIs')
@Controller('platform')
export class PlatformController {
  /**
   * Creates an instance of PlatformController.
   *
   * @param platformService - The platform service.
   */
  constructor(private readonly platformService: PlatformService) {}

  @Get()
  /**
   * Finds all.
   *
   * @returns The result of the operation.
   */
  findAll() {
    return this.platformService.findAll();
  }
}
