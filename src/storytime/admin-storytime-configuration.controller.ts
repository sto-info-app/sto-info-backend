import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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

import { SettingsService } from '../settings/settings.service';
import { STORYTIME_ENABLED_SETTING_KEY } from './constants/storytime-feature.constants';
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
   * @param _settingsService - Writes the runtime master switch.
   */
  constructor(
    private readonly _featureService: StorytimeFeatureService,
    private readonly _settingsService: SettingsService,
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
   * Switches Storytime on or off without a redeployment.
   *
   * @param dto - Whether Storytime should be enabled.
   * @param actingUserId - The administrator making the change.
   * @returns The resulting feature state.
   */
  @Patch()
  @ApiOperation({ summary: 'Switch Storytime on or off' })
  @ApiOkResponse({ type: StorytimeFeatureStateDto })
  @ApiForbiddenResponse({ description: 'Caller is not an administrator.' })
  async setEnabled(
    @Body() dto: SetStorytimeEnabledDto,
    @UserId() actingUserId: string,
  ): Promise<StorytimeFeatureStateDto> {
    await this._settingsService.setValue(
      STORYTIME_ENABLED_SETTING_KEY,
      String(dto.isEnabled),
      actingUserId,
    );

    return this._featureService.getState();
  }
}
