import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { getAppVersion } from './shared/utilities/version.utility';

@ApiTags('Core APIs')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Get Hello plus the environment name' })
  @ApiResponse({
    status: 200,
    description: 'The hello message has been successfully returned.',
  })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('version')
  @ApiOperation({ summary: 'Get the version of API app' })
  @ApiResponse({
    status: 200,
    description: 'The app version has been successfully returned.',
  })
  getVersion(): string {
    return getAppVersion();
  }
}
