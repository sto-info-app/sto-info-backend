import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { FleetConfigurationDto } from './dto/fleet-configuration.dto';
import { FleetFeatureService } from './fleet-feature.service';
import { FleetPolicyService } from './fleet-policy.service';

/**
 * What the client needs to render Fleet Community consistently with the server.
 *
 * Unauthenticated, and reachable while Fleet is switched off. This endpoint is
 * how the client learns that the feature is off, so refusing to answer would
 * leave it unable to hide the feature — the same reasoning the Storytime
 * configuration endpoint follows.
 *
 * It reports switches and published figures, and nothing about any Community,
 * Fleet or person. A switched-off feature therefore says only that it is
 * switched off.
 */
@ApiTags('Fleet')
@Controller('fleet/configuration')
export class FleetConfigurationController {
  /**
   * Creates an instance of FleetConfigurationController.
   *
   * @param _featureService - Reports which parts of Fleet Community are on.
   * @param _policyService - Reports the access and retention figures in force.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _policyService: FleetPolicyService,
  ) {}

  /**
   * Reports the feature switches and the published policy figures.
   *
   * The figures are served rather than repeated in client code so that the
   * numbers a user reads — "the last four hours", "kept for 45 days" — come
   * from the same place the server enforces them.
   *
   * @returns The Fleet client configuration.
   */
  @Get()
  @ApiOperation({ summary: 'Get the Fleet Community client configuration' })
  @ApiOkResponse({ type: FleetConfigurationDto })
  async getConfiguration(): Promise<FleetConfigurationDto> {
    return {
      features: await this._featureService.getState(),
      policy: {
        chatMemberHistoryHours: this._policyService.chatMemberHistoryHours,
        chatTranscriptHistoryDays:
          this._policyService.chatTranscriptHistoryDays,
        customChannelLimit: this._policyService.customChannelLimit,
        chatRetentionDays: this._policyService.chatRetentionDays,
        importSourceRetentionDays:
          this._policyService.importSourceRetentionDays,
      },
    };
  }
}
