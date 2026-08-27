import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';
import { AccessControlAdminService } from './access-control-admin.service';
import { PermissionDto, UserAccessSummaryDto } from './dto/permission.dto';
import { SetLimitOverrideDto } from './dto/set-limit-override.dto';
import { SetPermissionOverrideDto } from './dto/set-permission-override.dto';
import { UserLimitOverrideEntity } from './entities/user-limit-override.entity';

/**
 * Administrative management of what individual users may do.
 *
 * Every route requires the ADMIN role rather than a Storytime permission.
 * Gating the permission system behind a permission it also governs would be
 * circular: a mistaken override could leave nobody able to correct it.
 */
@ApiTags('Access control (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/access-control')
export class AccessControlAdminController {
  /**
   * Creates an instance of AccessControlAdminController.
   *
   * @param _adminService - The access control administration service.
   */
  constructor(private readonly _adminService: AccessControlAdminService) {}

  /**
   * Lists every permission the application recognises.
   *
   * @returns The known permissions.
   */
  @Get('permissions')
  @ApiOperation({ summary: 'List every permission the application recognises' })
  @ApiOkResponse({ type: [PermissionDto] })
  @ApiForbiddenResponse({ description: 'Caller is not an administrator.' })
  listPermissions(): Promise<PermissionDto[]> {
    return this._adminService.listPermissions();
  }

  /**
   * Reports what a user may currently do and why.
   *
   * @param userId - The user to describe.
   * @returns The user's effective permissions and active overrides.
   */
  @Get('users/:userId')
  @ApiOperation({ summary: "Report a user's effective permissions" })
  @ApiOkResponse({ type: UserAccessSummaryDto })
  @ApiNotFoundResponse({ description: 'User not found.' })
  @ApiForbiddenResponse({ description: 'Caller is not an administrator.' })
  getUserAccessSummary(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserAccessSummaryDto> {
    return this._adminService.getUserAccessSummary(userId);
  }

  /**
   * Grants or withholds a permission for a user.
   *
   * @param userId - The user the override applies to.
   * @param dto - The override to apply.
   * @param actingUserId - The administrator making the change.
   * @returns The user's updated access summary.
   */
  @Post('users/:userId/permission-overrides')
  @ApiOperation({ summary: 'Grant or withhold a permission for a user' })
  @ApiOkResponse({ type: UserAccessSummaryDto })
  @ApiBadRequestResponse({ description: 'Invalid override.' })
  @ApiNotFoundResponse({ description: 'User or permission not found.' })
  @ApiForbiddenResponse({ description: 'Caller is not an administrator.' })
  setPermissionOverride(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetPermissionOverrideDto,
    @UserId() actingUserId: string,
  ): Promise<UserAccessSummaryDto> {
    return this._adminService.setPermissionOverride(userId, dto, actingUserId);
  }

  /**
   * Withdraws a permission override.
   *
   * @param userId - The user the override applies to.
   * @param permissionCode - The permission code to stop overriding.
   * @param actingUserId - The administrator making the change.
   * @returns The user's updated access summary.
   */
  @Delete('users/:userId/permission-overrides/:permissionCode')
  @ApiOperation({ summary: 'Withdraw a permission override' })
  @ApiOkResponse({ type: UserAccessSummaryDto })
  @ApiNotFoundResponse({
    description: 'User, permission or override not found.',
  })
  @ApiForbiddenResponse({ description: 'Caller is not an administrator.' })
  removePermissionOverride(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('permissionCode') permissionCode: string,
    @UserId() actingUserId: string,
  ): Promise<UserAccessSummaryDto> {
    return this._adminService.removePermissionOverride(
      userId,
      permissionCode,
      actingUserId,
    );
  }

  /**
   * Lists a user's limit exemptions.
   *
   * @param userId - The user to read exemptions for.
   * @returns The exemptions currently recorded.
   */
  @Get('users/:userId/limit-overrides')
  @ApiOperation({ summary: "List a user's limit exemptions" })
  @ApiOkResponse({ type: [UserLimitOverrideEntity] })
  @ApiNotFoundResponse({ description: 'User not found.' })
  @ApiForbiddenResponse({ description: 'Caller is not an administrator.' })
  listLimitOverrides(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserLimitOverrideEntity[]> {
    return this._adminService.listLimitOverrides(userId);
  }

  /**
   * Grants a user a replacement value for a configured limit.
   *
   * @param userId - The user the exemption applies to.
   * @param dto - The exemption to apply.
   * @param actingUserId - The administrator making the change.
   */
  @Post('users/:userId/limit-overrides')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Allow a user to exceed a configured limit' })
  @ApiNoContentResponse({ description: 'Exemption applied.' })
  @ApiBadRequestResponse({ description: 'Invalid exemption.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  @ApiForbiddenResponse({ description: 'Caller is not an administrator.' })
  setLimitOverride(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetLimitOverrideDto,
    @UserId() actingUserId: string,
  ): Promise<void> {
    return this._adminService.setLimitOverride(userId, dto, actingUserId);
  }

  /**
   * Withdraws a limit exemption.
   *
   * @param userId - The user the exemption applies to.
   * @param limitKey - The configuration key to stop overriding.
   * @param actingUserId - The administrator making the change.
   */
  @Delete('users/:userId/limit-overrides/:limitKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw a limit exemption' })
  @ApiNoContentResponse({ description: 'Exemption withdrawn.' })
  @ApiNotFoundResponse({ description: 'User or exemption not found.' })
  @ApiForbiddenResponse({ description: 'Caller is not an administrator.' })
  removeLimitOverride(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('limitKey') limitKey: string,
    @UserId() actingUserId: string,
  ): Promise<void> {
    return this._adminService.removeLimitOverride(
      userId,
      limitKey,
      actingUserId,
    );
  }
}
