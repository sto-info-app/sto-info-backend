import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FeatureSwitch } from '../settings/feature-switches/feature-switch.constants';
import { FeatureSwitchesService } from '../settings/feature-switches/feature-switches.service';
import { SetStorytimeEnabledDto } from './dto/set-storytime-enabled.dto';
import { StorytimeFeatureStateDto } from './dto/storytime-configuration.dto';
import { StorytimeFeatureService } from './storytime-feature.service';

/**
 * Administrative control of the Storytime master switch.
 *
 * Gated by the ADMIN role rather than a Storytime permission. Storytime's own
 * permissions are only meaningful while Storytime is switched on, so gating
 * the switch behind one would mean the control that recovers the feature could
 * itself become unreachable.
 *
 * Switching writes through the Admin page's feature switches (FC-045), so it
 * takes the same reason and leaves the same site admin log entry.
 */
@ApiTags('Storytime (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/storytime/configuration')
export class AdminStorytimeConfigurationController {
  /**
   * Creates an instance of AdminStorytimeConfigurationController.
   *
   * @param _featureService - Reports which parts of Storytime are switched on.
   * @param _switches - Writes the runtime master switch, and logs it.
   */
  constructor(
    private readonly _featureService: StorytimeFeatureService,
    private readonly _switches: FeatureSwitchesService,
  ) {}

  /**
   * Reports the current state of every Storytime switch.
   *
   * @returns The feature state.
   */
  @Get()
  @ApiOperation({ summary: 'Get the current Storytime feature state' })
  @ApiOkResponse({ type: StorytimeFeatureStateDto })
  @ApiForbiddenResponse({ description: 'Caller is not an administrator.' })
  getFeatureState(): Promise<StorytimeFeatureStateDto> {
    return this._featureService.getState();
  }

  /**
   * Switches Storytime on or off without a redeployment, with a reason for
   * the site admin log.
   *
   * @param dto - Whether Storytime should be enabled, and why.
   * @param actingUserId - The administrator making the change.
   * @returns The resulting feature state.
   */
  @Patch()
  @ApiOperation({ summary: 'Switch Storytime on or off, with a reason' })
  @ApiOkResponse({ type: StorytimeFeatureStateDto })
  @ApiForbiddenResponse({ description: 'Caller is not an administrator.' })
  @ApiConflictResponse({ description: 'It is already in that position.' })
  async setEnabled(
    @Body() dto: SetStorytimeEnabledDto,
    @UserId() actingUserId: string,
  ): Promise<StorytimeFeatureStateDto> {
    await this._switches.set(
      FeatureSwitch.STORYTIME,
      dto.isEnabled,
      actingUserId,
      dto.reason,
    );

    return this._featureService.getState();
  }
}
