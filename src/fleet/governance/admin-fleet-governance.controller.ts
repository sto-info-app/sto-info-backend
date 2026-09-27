import {
  Body,
  Controller,
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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FleetFeatureService } from '../fleet-feature.service';
import {
  CommunityDisputeViewDto,
  ReassignOwnershipDto,
} from './dto/ownership-transfer.dto';
import { GovernanceReasonDto } from './dto/scope-governance.dto';
import { OwnershipTransferService } from './services/ownership-transfer.service';
import { ScopeClosureService } from './services/scope-closure.service';

/**
 * A site administrator's dispute actions on a Community (FC-022).
 *
 * For an Owner who has vanished or a Community that has been reported:
 * ownership moves to one of its Admins with no acceptance, or the Community
 * closes. Both need a reason, and both are logged as a site administrator's.
 * Nothing here grants a scoped capability: a site administrator holds none,
 * and these are the only two things they may do.
 */
@ApiTags('Fleet governance (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/fleet-communities/:communityId')
export class AdminFleetGovernanceController {
  /**
   * Creates an instance of AdminFleetGovernanceController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _transfers - Moves ownership.
   * @param _closure - Closes.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _transfers: OwnershipTransferService,
    private readonly _closure: ScopeClosureService,
  ) {}

  /**
   * Reads what a dispute action needs.
   *
   * @param communityId - The Community.
   * @returns Its Owner, its Admins and any open offer.
   */
  @Get('dispute')
  @ApiOperation({ summary: 'Read a Community for a dispute action (admin)' })
  @ApiOkResponse({ type: CommunityDisputeViewDto })
  @ApiForbiddenResponse({ description: 'Not a site administrator.' })
  async dispute(
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<CommunityDisputeViewDto> {
    await this._featureService.assertEnabled();

    return this._transfers.disputeView(communityId);
  }

  /**
   * Moves ownership to one of the Community's Admins.
   *
   * @param communityId - The Community.
   * @param dto - Who, and why.
   * @param userId - The site administrator.
   */
  @Post('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Move a Community’s ownership (admin)' })
  @ApiNoContentResponse({ description: 'Moved.' })
  @ApiBadRequestResponse({ description: 'No reason, or not an Admin.' })
  async reassign(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: ReassignOwnershipDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._transfers.reassign(
      communityId,
      dto.toUserId,
      dto.reason,
      userId,
    );
  }

  /**
   * Closes the Community.
   *
   * @param communityId - The Community.
   * @param dto - Why.
   * @param userId - The site administrator.
   */
  @Post('close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close a Community (admin)' })
  @ApiNoContentResponse({ description: 'Closed.' })
  async close(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: GovernanceReasonDto,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._closure.closeCommunity(communityId, {
      reason: dto.reason,
      actorUserId: userId,
      asSiteAdmin: true,
    });
  }
}
