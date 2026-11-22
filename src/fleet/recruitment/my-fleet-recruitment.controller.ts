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
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { FleetFeatureService } from '../fleet-feature.service';
import {
  FleetCharacterChoiceDto,
  MyFleetApplicationDto,
} from './dto/fleet-application.dto';
import { MyFleetInvitationDto } from './dto/fleet-invitation.dto';
import { FleetApplicationService } from './services/fleet-application.service';
import { FleetInvitationService } from './services/fleet-invitation.service';

/**
 * The signed-in person's own applications and invitations, across every
 * Fleet (FC-021).
 *
 * Where somebody learns how their application went: a routine decision
 * reaches them here, as a status, rather than as a notification.
 */
@ApiTags('Fleet recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fleet-recruitment')
export class MyFleetRecruitmentController {
  /**
   * Creates an instance of MyFleetRecruitmentController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _applicationService - Applications.
   * @param _invitationService - Invitations.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _applicationService: FleetApplicationService,
    private readonly _invitationService: FleetInvitationService,
  ) {}

  /**
   * Lists the caller's applications and joins, newest first.
   *
   * @param userId - The caller.
   * @returns Each, with its Fleet and status.
   */
  @Get('applications')
  @ApiOperation({ summary: 'List my Fleet applications' })
  @ApiOkResponse({ type: [MyFleetApplicationDto] })
  async applications(
    @UserId() userId: string,
  ): Promise<MyFleetApplicationDto[]> {
    await this._featureService.assertEnabled();

    return this._applicationService.listMine(userId);
  }

  /**
   * Takes back one of the caller's pending applications.
   *
   * @param applicationId - The application.
   * @param userId - The caller.
   * @returns The application.
   */
  @Post('applications/:applicationId/withdraw')
  @ApiOperation({ summary: 'Withdraw my application' })
  @ApiOkResponse({ type: MyFleetApplicationDto })
  @ApiNotFoundResponse({ description: 'Not the caller’s application.' })
  @ApiConflictResponse({ description: 'Already decided or withdrawn.' })
  async withdraw(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @UserId() userId: string,
  ): Promise<MyFleetApplicationDto> {
    await this._featureService.assertEnabled();

    return this._applicationService.withdraw(applicationId, userId);
  }

  /**
   * Lists the caller's open invitations.
   *
   * @param userId - The caller.
   * @returns Each, with its Fleet.
   */
  @Get('invitations')
  @ApiOperation({ summary: 'List my open Fleet invitations' })
  @ApiOkResponse({ type: [MyFleetInvitationDto] })
  async invitations(@UserId() userId: string): Promise<MyFleetInvitationDto[]> {
    await this._featureService.assertEnabled();

    return this._invitationService.listMine(userId);
  }

  /**
   * Accepts an invitation with one of the caller's Characters.
   *
   * @param invitationId - The invitation.
   * @param userId - The caller.
   * @param dto - The Character.
   * @returns The record of how they came in.
   */
  @Post('invitations/:invitationId/accept')
  @ApiOperation({ summary: 'Accept a Fleet invitation' })
  @ApiOkResponse({ type: MyFleetApplicationDto })
  @ApiNotFoundResponse({ description: 'Not the caller’s invitation.' })
  @ApiConflictResponse({
    description: 'Lapsed, answered, or a member already.',
  })
  async accept(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @UserId() userId: string,
    @Body() dto: FleetCharacterChoiceDto,
  ): Promise<MyFleetApplicationDto> {
    await this._featureService.assertEnabled();

    return this._invitationService.accept(
      invitationId,
      userId,
      dto.characterId,
    );
  }

  /**
   * Declines an invitation.
   *
   * @param invitationId - The invitation.
   * @param userId - The caller.
   */
  @Post('invitations/:invitationId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Decline a Fleet invitation' })
  @ApiNoContentResponse({ description: 'Declined.' })
  async decline(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._invitationService.decline(invitationId, userId);
  }
}
