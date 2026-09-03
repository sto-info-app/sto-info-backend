import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AppService } from './app.service';
import { Public } from './auth/public.decorator';
import { getAppVersion } from './shared/utilities/version.utility';

/**
 * Creates an instance of AppController.
 *
 * @param appService - Application core service used for basic operations.
 */
@ApiTags('Core APIs')
@Controller()
export class AppController {
  /**
   * Creates an instance of AppController.
   *
   * @param _appService - The app service.
   */
  constructor(private readonly _appService: AppService) {}

  /**
   * Returns a greeting message including the current environment name.
   *
   * @returns A greeting message string.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Get Hello plus the environment name' })
  @ApiOkResponse({
    description: 'The hello message has been successfully returned.',
  })
  getHello(): string {
    return this._appService.getHello();
  }

  /**
   * Returns the current version of the API application.
   *
   * @returns The semantic version string of the application.
   */
  @Public()
  @Get('version')
  @ApiOperation({ summary: 'Get the version of API app' })
  @ApiOkResponse({
    description: 'The app version has been successfully returned.',
  })
  getVersion(): string {
    return getAppVersion();
  }
}
