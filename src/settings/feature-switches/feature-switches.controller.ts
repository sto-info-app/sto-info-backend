import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FeatureSwitch } from './feature-switch.constants';
import { FeatureSwitchDto, SetFeatureSwitchDto } from './feature-switch.dto';
import { FeatureSwitchesService } from './feature-switches.service';

/**
 * The site features' master switches, on the Admin page (FC-045).
 *
 * Gated by the ADMIN role rather than any feature's own permission: a
 * feature's permissions mean nothing while it is off, so the control that
 * turns it back on must not depend on one.
 */
@ApiTags('Feature switches (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
@Controller('admin/feature-switches')
export class FeatureSwitchesController {
  /**
   * Creates an instance of FeatureSwitchesController.
   *
   * @param _switches - The switches.
   */
  constructor(private readonly _switches: FeatureSwitchesService) {}

  /**
   * Every feature switch, with the capability flags beneath it.
   *
   * @returns The switches.
   */
  @Get()
  @ApiOperation({ summary: 'Read every feature switch (admin)' })
  @ApiOkResponse({ type: [FeatureSwitchDto] })
  list(): Promise<FeatureSwitchDto[]> {
    return this._switches.list();
  }

  /**
   * Switches a feature on or off, with a reason for the site admin log.
   *
   * @param feature - The feature.
   * @param dto - On or off, and why.
   * @param adminUserId - The site admin.
   * @returns The switch as it now stands.
   */
  @Patch(':feature')
  @ApiOperation({
    summary: 'Switch a feature on or off, with a reason (admin)',
  })
  @ApiParam({ name: 'feature', enum: FeatureSwitch })
  @ApiOkResponse({ type: FeatureSwitchDto })
  @ApiConflictResponse({ description: 'It is already in that position.' })
  @ApiNotFoundResponse({ description: 'The switch is missing.' })
  set(
    @Param('feature', new ParseEnumPipe(FeatureSwitch)) feature: FeatureSwitch,
    @Body() dto: SetFeatureSwitchDto,
    @UserId() adminUserId: string,
  ): Promise<FeatureSwitchDto> {
    return this._switches.set(feature, dto.isEnabled, adminUserId, dto.reason);
  }
}
