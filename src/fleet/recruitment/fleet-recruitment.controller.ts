import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { OptionalUserId, UserId } from 'src/auth/user-id.decorator';

import { FleetAudienceService } from '../authorisation/fleet-audience.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { RequiresScopeCapability } from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { StoFleetService } from '../services/sto-fleet.service';
import {
  DecideFleetApplicationDto,
  FleetApplicationDetailDto,
  FleetApplicationPageDto,
  FleetApplicationQueryDto,
  FleetCharacterChoiceDto,
  MyFleetApplicationDto,
  SubmitFleetApplicationDto,
} from './dto/fleet-application.dto';
import {
  CreateFleetInvitationDto,
  FleetInvitationDto,
} from './dto/fleet-invitation.dto';
import { FleetMemberDto, RemoveFleetMemberDto } from './dto/fleet-member.dto';
import { FleetRecruitmentViewDto } from './dto/fleet-recruitment-view.dto';
import {
  RecruitmentSettingsDto,
  UpdateRecruitmentSettingsDto,
} from './dto/recruitment-settings.dto';
import { FleetApplicationService } from './services/fleet-application.service';
import { FleetInvitationService } from './services/fleet-invitation.service';
import { FleetRecruitmentViewService } from './services/fleet-recruitment-view.service';
import { RecruitmentMembershipService } from './services/recruitment-membership.service';
import { RecruitmentSettingsService } from './services/recruitment-settings.service';

/** Where every guarded route here finds its Fleet. */
const FLEET_SOURCE = {
  kind: FleetScopeKind.FLEET,
  param: 'fleetId',
  communityParam: 'communityId',
} as const;

/**
 * A Fleet's recruitment: how it takes members, and the applications,
 * invitations and members that follow (FC-021).
 *
 * How a Fleet recruits is shown to whoever may see it. Joining, applying and
 * leaving need only a signed-in person, whose own eligibility is checked by
 * the service. Everything else needs a capability at the Fleet: reading
 * applications `applications.view`, deciding them and inviting
 * `applications.decide`, changing the settings `recruitment.manage`, and
 * removing members `members.manage`.
 */
@ApiTags('Fleet recruitment')
@ApiBearerAuth()
@Controller('fleet-communities/:communityId/fleets/:fleetId/recruitment')
export class FleetRecruitmentController {
  /**
   * Creates an instance of FleetRecruitmentController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _fleetService - Reads Fleets.
   * @param _audienceService - Says who may see a Fleet.
   * @param _viewService - Describes recruitment for a viewer.
   * @param _settingsService - Saves recruitment settings.
   * @param _applicationService - Applications, joins and decisions.
   * @param _invitationService - Invitations.
   * @param _membershipService - Members, leaving and removal.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _fleetService: StoFleetService,
    private readonly _audienceService: FleetAudienceService,
    private readonly _viewService: FleetRecruitmentViewService,
    private readonly _settingsService: RecruitmentSettingsService,
    private readonly _applicationService: FleetApplicationService,
    private readonly _invitationService: FleetInvitationService,
    private readonly _membershipService: RecruitmentMembershipService,
  ) {}

  /**
   * Describes how a Fleet recruits, and where the viewer stands.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The viewer, or null when signed out.
   * @returns The settings, and the viewer's standing when signed in.
   */
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Read how a Fleet recruits' })
  @ApiOkResponse({ type: FleetRecruitmentViewDto })
  @ApiNotFoundResponse({
    description: 'No such Fleet, or the caller may not see it.',
  })
  async view(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @OptionalUserId() userId: string | null,
  ): Promise<FleetRecruitmentViewDto> {
    await this._featureService.assertEnabled();

    const fleet = await this._fleetService.findByIdOrFail(communityId, fleetId);
    await this._audienceService.assertCanView(
      fleet.visibility,
      { kind: FleetScopeKind.FLEET, id: fleet.id },
      userId,
    );

    return this._viewService.view(fleet, userId);
  }

  /**
   * Saves a new version of how a Fleet recruits.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The editor.
   * @param dto - The state, requirements and questions.
   * @returns How the Fleet now recruits.
   */
  @Put('settings')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.RECRUITMENT_MANAGE, FLEET_SOURCE)
  @ApiOperation({ summary: 'Change how a Fleet recruits' })
  @ApiOkResponse({ type: RecruitmentSettingsDto })
  @ApiBadRequestResponse({ description: 'A faction or question is invalid.' })
  @ApiConflictResponse({
    description: 'Somebody saved a newer version meanwhile.',
  })
  async saveSettings(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() dto: UpdateRecruitmentSettingsDto,
  ): Promise<RecruitmentSettingsDto> {
    await this._featureService.assertEnabled();
    await this._settingsService.save(communityId, fleetId, dto, userId);

    return this._settingsService.describe(
      await this._fleetService.findByIdOrFail(communityId, fleetId),
    );
  }

  /**
   * Joins an OPEN Fleet with one of the caller's Characters.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - Who is joining.
   * @param dto - The Character.
   * @returns The record of the join.
   */
  @Post('join')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Join an open Fleet' })
  @ApiOkResponse({ type: MyFleetApplicationDto })
  @ApiConflictResponse({
    description: 'Not open, already a member, or the Owner.',
  })
  async join(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() dto: FleetCharacterChoiceDto,
  ): Promise<MyFleetApplicationDto> {
    await this._featureService.assertEnabled();

    return this._applicationService.join(communityId, fleetId, userId, dto);
  }

  /**
   * Leaves a Fleet.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The member.
   */
  @Post('leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Leave a Fleet' })
  @ApiNoContentResponse({ description: 'Left.' })
  async leave(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._membershipService.leave(communityId, fleetId, userId);
  }

  /**
   * Applies to a Fleet with one of the caller's Characters.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The applicant.
   * @param dto - The Character, the form version seen and the answers.
   * @returns The application.
   */
  @Post('applications')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Apply to a Fleet' })
  @ApiOkResponse({ type: MyFleetApplicationDto })
  @ApiBadRequestResponse({
    description: 'An answer or the Character is not valid.',
  })
  @ApiConflictResponse({
    description:
      'Not taking applications, form changed, already pending or a member.',
  })
  async submit(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() dto: SubmitFleetApplicationDto,
  ): Promise<MyFleetApplicationDto> {
    await this._featureService.assertEnabled();

    return this._applicationService.submit(communityId, fleetId, userId, dto);
  }

  /**
   * Lists a Fleet's applications.
   *
   * @param fleetId - The Fleet.
   * @param query - The status and page.
   * @returns The page.
   */
  @Get('applications')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.APPLICATIONS_VIEW, FLEET_SOURCE)
  @ApiOperation({ summary: "List a Fleet's applications" })
  @ApiOkResponse({ type: FleetApplicationPageDto })
  async applications(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Query() query: FleetApplicationQueryDto,
  ): Promise<FleetApplicationPageDto> {
    await this._featureService.assertEnabled();

    return this._applicationService.page(fleetId, query);
  }

  /**
   * Reads one application in full.
   *
   * @param fleetId - The Fleet.
   * @param applicationId - The application.
   * @returns It, with answers, evidence and history.
   */
  @Get('applications/:applicationId')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.APPLICATIONS_VIEW, FLEET_SOURCE)
  @ApiOperation({ summary: 'Read one application' })
  @ApiOkResponse({ type: FleetApplicationDetailDto })
  @ApiNotFoundResponse({ description: 'No such application here.' })
  async application(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<FleetApplicationDetailDto> {
    await this._featureService.assertEnabled();

    return this._applicationService.detail(fleetId, applicationId);
  }

  /**
   * Accepts or rejects an application.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param applicationId - The application.
   * @param userId - The decider.
   * @param dto - The decision, reason or note, and revision seen.
   * @returns The application in full.
   */
  @Post('applications/:applicationId/decision')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.APPLICATIONS_DECIDE, FLEET_SOURCE)
  @ApiOperation({ summary: 'Decide an application' })
  @ApiOkResponse({ type: FleetApplicationDetailDto })
  @ApiBadRequestResponse({ description: 'A rejection without a reason.' })
  @ApiConflictResponse({ description: 'Already decided, or changed since.' })
  async decide(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @UserId() userId: string,
    @Body() dto: DecideFleetApplicationDto,
  ): Promise<FleetApplicationDetailDto> {
    await this._featureService.assertEnabled();

    return this._applicationService.decide(
      communityId,
      fleetId,
      applicationId,
      userId,
      dto,
    );
  }

  /**
   * Lists a Fleet's invitations.
   *
   * @param fleetId - The Fleet.
   * @returns The invitations, newest first.
   */
  @Get('invitations')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.APPLICATIONS_VIEW, FLEET_SOURCE)
  @ApiOperation({ summary: "List a Fleet's invitations" })
  @ApiOkResponse({ type: [FleetInvitationDto] })
  async invitations(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
  ): Promise<FleetInvitationDto[]> {
    await this._featureService.assertEnabled();

    return this._invitationService.list(fleetId);
  }

  /**
   * Invites somebody by username.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param userId - The officer.
   * @param dto - The invitee's username.
   * @returns The invitation.
   */
  @Post('invitations')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.APPLICATIONS_DECIDE, FLEET_SOURCE)
  @ApiOperation({ summary: 'Invite somebody to a Fleet' })
  @ApiOkResponse({ type: FleetInvitationDto })
  @ApiNotFoundResponse({ description: 'Nobody has that username.' })
  @ApiConflictResponse({
    description: 'Already a member, already invited, or the Owner.',
  })
  async invite(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() dto: CreateFleetInvitationDto,
  ): Promise<FleetInvitationDto> {
    await this._featureService.assertEnabled();

    return this._invitationService.invite(
      communityId,
      fleetId,
      dto.username,
      userId,
    );
  }

  /**
   * Takes back an invitation.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param invitationId - The invitation.
   * @returns The invitation.
   */
  @Post('invitations/:invitationId/withdraw')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.APPLICATIONS_DECIDE, FLEET_SOURCE)
  @ApiOperation({ summary: 'Withdraw an invitation' })
  @ApiOkResponse({ type: FleetInvitationDto })
  @ApiConflictResponse({ description: 'It lapsed or was answered.' })
  async withdrawInvitation(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<FleetInvitationDto> {
    await this._featureService.assertEnabled();

    return this._invitationService.withdraw(communityId, fleetId, invitationId);
  }

  /**
   * Lists a Fleet's members.
   *
   * @param fleetId - The Fleet.
   * @returns The members, newest first.
   */
  @Get('members')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.MEMBERS_MANAGE, FLEET_SOURCE)
  @ApiOperation({ summary: "List a Fleet's members" })
  @ApiOkResponse({ type: [FleetMemberDto] })
  async members(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
  ): Promise<FleetMemberDto[]> {
    await this._featureService.assertEnabled();

    return this._membershipService.list(fleetId);
  }

  /**
   * Removes a member, with a reason.
   *
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param membershipId - The membership.
   * @param userId - Who is removing them.
   * @param dto - Why.
   */
  @Post('members/:membershipId/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.MEMBERS_MANAGE, FLEET_SOURCE)
  @ApiOperation({ summary: 'Remove a member' })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiConflictResponse({ description: 'They hold a role at the Fleet.' })
  async removeMember(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @UserId() userId: string,
    @Body() dto: RemoveFleetMemberDto,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._membershipService.remove(
      communityId,
      fleetId,
      membershipId,
      dto.reason,
      userId,
    );
  }
}
