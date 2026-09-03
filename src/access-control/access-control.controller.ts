import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { AccessControlService } from './access-control.service';
import { MyPermissionsDto } from './dto/my-permissions.dto';

/**
 * Reports the caller's own permissions so the client can present the right
 * controls.
 *
 * This exists for presentation only. The client hiding a button is a courtesy,
 * never a protection: every capability it describes is independently enforced
 * on the endpoint that performs the action.
 */
@ApiTags('Access control')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('access-control')
export class AccessControlController {
  /**
   * Creates an instance of AccessControlController.
   *
   * @param _accessControlService - Resolves the caller's permissions.
   */
  constructor(private readonly _accessControlService: AccessControlService) {}

  /**
   * Lists the permissions the caller currently holds.
   *
   * @param userId - The authenticated caller.
   * @returns The caller's permission codes.
   */
  @Get('me')
  @ApiOperation({ summary: 'List the permissions the caller currently holds' })
  @ApiOkResponse({ type: MyPermissionsDto })
  async getMyPermissions(@UserId() userId: string): Promise<MyPermissionsDto> {
    const permissions =
      await this._accessControlService.getPermissionCodes(userId);

    return {
      permissions: [...permissions].sort((a, b) => a.localeCompare(b)),
    };
  }
}
