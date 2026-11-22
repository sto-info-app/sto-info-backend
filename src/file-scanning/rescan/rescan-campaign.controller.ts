import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
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
import { AdminReasonDto } from 'src/shared/dto/admin-reason.dto';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FileRescanCampaignEntity } from './file-rescan-campaign.entity';
import { RescanCampaignService } from './rescan-campaign.service';
import { RescanVerdictService } from './rescan-verdict.service';
import {
  DecideRescanFindingDto,
  RescanCampaignDto,
  RescanOverviewDto,
  StartRescanCampaignDto,
} from './rescan.dto';

/**
 * Shows a campaign.
 *
 * @param campaign - The campaign.
 * @returns It, as the page shows it.
 */
function campaignDto(campaign: FileRescanCampaignEntity): RescanCampaignDto {
  return {
    id: campaign.id,
    kind: campaign.kind,
    state: campaign.state,
    selection: { ...campaign.selection },
    counts: { ...campaign.counts } as Record<string, number>,
    lastError: campaign.lastError,
    createdAt: campaign.createdAt,
    finishedAt: campaign.finishedAt,
  };
}

/**
 * The site admins' rescan campaigns (FC-041), on Scan Diagnostics. Counts
 * and asset IDs only: nothing here names a file, an owner or a signature.
 */
@ApiTags('File scanning (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
@Controller('admin/rescan-campaigns')
export class RescanCampaignController {
  /**
   * Creates an instance of RescanCampaignController.
   *
   * @param _campaigns - The campaigns.
   * @param _verdicts - Decides a policy refusal (FC-050).
   */
  constructor(
    private readonly _campaigns: RescanCampaignService,
    private readonly _verdicts: RescanVerdictService,
  ) {}

  /**
   * Where the campaigns stand.
   *
   * @returns The latest campaigns, what is waiting and the latest findings.
   */
  @Get()
  @ApiOperation({ summary: 'Read the rescan campaigns (admin)' })
  @ApiOkResponse({ type: RescanOverviewDto })
  async overview(): Promise<RescanOverviewDto> {
    const overview = await this._campaigns.overview();

    return { ...overview, campaigns: overview.campaigns.map(campaignDto) };
  }

  /**
   * Starts a campaign.
   *
   * @param adminUserId - The site admin.
   * @param dto - Which pictures, and why.
   * @returns The campaign.
   */
  @Post()
  @ApiOperation({ summary: 'Start a rescan campaign, with a reason (admin)' })
  @ApiOkResponse({ type: RescanCampaignDto })
  async start(
    @UserId() adminUserId: string,
    @Body() dto: StartRescanCampaignDto,
  ): Promise<RescanCampaignDto> {
    return campaignDto(
      await this._campaigns.start(
        { ...dto.selection },
        adminUserId,
        dto.reason,
      ),
    );
  }

  /**
   * Pauses a running campaign.
   *
   * @param campaignId - The campaign.
   * @param adminUserId - The site admin.
   * @param dto - Why.
   * @returns The campaign.
   */
  @Post(':campaignId/pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pause a rescan campaign (admin)' })
  @ApiOkResponse({ type: RescanCampaignDto })
  @ApiConflictResponse({ description: 'It is not running.' })
  async pause(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @UserId() adminUserId: string,
    @Body() dto: AdminReasonDto,
  ): Promise<RescanCampaignDto> {
    return campaignDto(
      await this._campaigns.pause(campaignId, adminUserId, dto.reason),
    );
  }

  /**
   * Resumes a paused or failed campaign.
   *
   * @param campaignId - The campaign.
   * @param adminUserId - The site admin.
   * @param dto - Why.
   * @returns The campaign.
   */
  @Post(':campaignId/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resume a rescan campaign (admin)' })
  @ApiOkResponse({ type: RescanCampaignDto })
  @ApiConflictResponse({ description: 'It is not paused or failed.' })
  async resume(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @UserId() adminUserId: string,
    @Body() dto: AdminReasonDto,
  ): Promise<RescanCampaignDto> {
    return campaignDto(
      await this._campaigns.resume(campaignId, adminUserId, dto.reason),
    );
  }

  /**
   * Cancels an open campaign.
   *
   * @param campaignId - The campaign.
   * @param adminUserId - The site admin.
   * @param dto - Why.
   * @returns The campaign.
   */
  @Post(':campaignId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a rescan campaign (admin)' })
  @ApiOkResponse({ type: RescanCampaignDto })
  @ApiConflictResponse({ description: 'It has finished.' })
  async cancel(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @UserId() adminUserId: string,
    @Body() dto: AdminReasonDto,
  ): Promise<RescanCampaignDto> {
    return campaignDto(
      await this._campaigns.cancel(campaignId, adminUserId, dto.reason),
    );
  }

  /**
   * Decides a picture refused for policy on rescan: takes it down, telling
   * its owner, or keeps it, with a reason for the site admin log (FC-050).
   *
   * @param rescanId - The rescan that refused it.
   * @param adminUserId - The site admin.
   * @param dto - The decision, and why.
   */
  @Post('findings/:rescanId/decision')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Take down or keep a picture refused for policy (admin)',
  })
  @ApiNoContentResponse({ description: 'Decided, and logged.' })
  @ApiNotFoundResponse({ description: 'There is no such rescan.' })
  @ApiConflictResponse({
    description: 'It is not a policy refusal, or has already been decided.',
  })
  async decide(
    @Param('rescanId', ParseUUIDPipe) rescanId: string,
    @UserId() adminUserId: string,
    @Body() dto: DecideRescanFindingDto,
  ): Promise<void> {
    await this._verdicts.decide(
      rescanId,
      adminUserId,
      dto.decision,
      dto.reason,
    );
  }
}
