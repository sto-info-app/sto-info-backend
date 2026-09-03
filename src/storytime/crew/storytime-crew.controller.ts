import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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

import { PERMISSION_CODES } from 'src/access-control/constants/permission-codes.constants';
import { PermissionsGuard } from 'src/access-control/permissions.guard';
import { RequiresPermission } from 'src/access-control/requires-permission.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { CollaboratorDto } from './dto/collaborator.dto';
import { CreateCrewCreditDto } from './dto/create-crew-credit.dto';
import { CrewCreditDto } from './dto/crew-credit.dto';
import { InviteCollaboratorDto } from './dto/invite-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';
import { UpdateCrewCreditDto } from './dto/update-crew-credit.dto';
import { StorytimeCollaboratorService } from './storytime-collaborator.service';
import { StorytimeCrewCreditService } from './storytime-crew-credit.service';
import { StorytimeCrewMapper } from './storytime-crew.mapper';

/**
 * Managing who helps write a Story, and who gets credited for it.
 *
 * The two are deliberately separate throughout. Inviting somebody hands them
 * the ability to change the Story and needs the collaborator capability;
 * crediting somebody is public thanks and needs only the crew one.
 */
@ApiTags('Storytime (creator)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN)
@Controller('storytime/manage')
export class StorytimeCrewController {
  /**
   * Creates an instance of StorytimeCrewController.
   *
   * @param _collaboratorService - Invitations and their lifecycle.
   * @param _creditService - Crew credits.
   * @param _mapper - Maps collaborations and credits to their response shapes.
   * @param _featureService - Reports whether creation is switched on.
   */
  constructor(
    private readonly _collaboratorService: StorytimeCollaboratorService,
    private readonly _creditService: StorytimeCrewCreditService,
    private readonly _mapper: StorytimeCrewMapper,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the collaborators on a Story.
   *
   * @param storyId - The Story.
   * @param userId - The caller.
   * @returns The collaborators.
   */
  @Get('stories/:storyId/collaborators')
  @ApiOperation({ summary: 'List who is helping write a Story' })
  @ApiOkResponse({ type: [CollaboratorDto] })
  @ApiForbiddenResponse({ description: 'No access to this Story.' })
  async findCollaborators(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @UserId() userId: string,
  ): Promise<CollaboratorDto[]> {
    await this.assertEnabled();

    return this._mapper.toCollaboratorList(
      await this._collaboratorService.findByStory(storyId, userId),
    );
  }

  /**
   * Lists the invitations waiting on the caller.
   *
   * @param userId - The caller.
   * @returns Their unanswered invitations.
   */
  @Get('collaborations/invitations')
  @ApiOperation({
    summary: 'List the collaboration invitations waiting on you',
  })
  @ApiOkResponse({ type: [CollaboratorDto] })
  async findMyInvitations(
    @UserId() userId: string,
  ): Promise<CollaboratorDto[]> {
    await this.assertEnabled();

    return this._mapper.toCollaboratorList(
      await this._collaboratorService.findPendingForUser(userId),
    );
  }

  /**
   * Invites somebody to collaborate on a Story.
   *
   * @param storyId - The Story.
   * @param dto - Who to invite and what they may do.
   * @param userId - The caller.
   * @returns The invitation.
   */
  @Post('stories/:storyId/collaborators')
  @ApiOperation({ summary: 'Invite somebody to help write a Story' })
  @ApiOkResponse({ type: CollaboratorDto })
  @ApiBadRequestResponse({ description: 'Already invited, or the owner.' })
  async invite(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: InviteCollaboratorDto,
    @UserId() userId: string,
  ): Promise<CollaboratorDto> {
    await this.assertEnabled();

    return this._mapper.toCollaborator(
      await this._collaboratorService.invite(storyId, dto, userId),
    );
  }

  /**
   * Changes what a collaborator may do.
   *
   * @param collaboratorId - The collaboration.
   * @param dto - The capabilities to set.
   * @param userId - The caller.
   * @returns The collaboration after the change.
   */
  @Patch('collaborators/:collaboratorId')
  @ApiOperation({ summary: 'Change what a collaborator may do' })
  @ApiOkResponse({ type: CollaboratorDto })
  async updateCollaborator(
    @Param('collaboratorId', ParseUUIDPipe) collaboratorId: string,
    @Body() dto: UpdateCollaboratorDto,
    @UserId() userId: string,
  ): Promise<CollaboratorDto> {
    await this.assertEnabled();

    return this._mapper.toCollaborator(
      await this._collaboratorService.updateCapabilities(
        collaboratorId,
        dto,
        userId,
      ),
    );
  }

  /**
   * Accepts an invitation.
   *
   * @param collaboratorId - The invitation.
   * @param userId - The caller.
   * @returns The accepted collaboration.
   */
  @Post('collaborators/:collaboratorId/accept')
  @ApiOperation({ summary: 'Accept an invitation to collaborate' })
  @ApiOkResponse({ type: CollaboratorDto })
  @ApiForbiddenResponse({ description: 'Not your invitation.' })
  async accept(
    @Param('collaboratorId', ParseUUIDPipe) collaboratorId: string,
    @UserId() userId: string,
  ): Promise<CollaboratorDto> {
    await this.assertEnabled();

    return this._mapper.toCollaborator(
      await this._collaboratorService.accept(collaboratorId, userId),
    );
  }

  /**
   * Declines an invitation.
   *
   * @param collaboratorId - The invitation.
   * @param userId - The caller.
   * @returns The declined collaboration.
   */
  @Post('collaborators/:collaboratorId/decline')
  @ApiOperation({ summary: 'Decline an invitation to collaborate' })
  @ApiOkResponse({ type: CollaboratorDto })
  async decline(
    @Param('collaboratorId', ParseUUIDPipe) collaboratorId: string,
    @UserId() userId: string,
  ): Promise<CollaboratorDto> {
    await this.assertEnabled();

    return this._mapper.toCollaborator(
      await this._collaboratorService.decline(collaboratorId, userId),
    );
  }

  /**
   * Withdraws an invitation, removes a collaborator, or steps down.
   *
   * @param collaboratorId - The collaboration.
   * @param userId - The caller.
   * @returns The revoked collaboration.
   */
  @Post('collaborators/:collaboratorId/revoke')
  @ApiOperation({
    summary: 'Withdraw, remove, or step down from a collaboration',
  })
  @ApiOkResponse({ type: CollaboratorDto })
  async revoke(
    @Param('collaboratorId', ParseUUIDPipe) collaboratorId: string,
    @UserId() userId: string,
  ): Promise<CollaboratorDto> {
    await this.assertEnabled();

    return this._mapper.toCollaborator(
      await this._collaboratorService.revoke(collaboratorId, userId),
    );
  }

  /**
   * Adds a credit to a Story.
   *
   * @param storyId - The Story.
   * @param dto - The credit to add.
   * @param userId - The caller.
   * @returns The credit.
   */
  @Post('stories/:storyId/credits')
  @ApiOperation({ summary: 'Credit somebody on a Story' })
  @ApiOkResponse({ type: CrewCreditDto })
  @ApiBadRequestResponse({
    description: 'Already credited, or names something from another Story.',
  })
  async createCredit(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: CreateCrewCreditDto,
    @UserId() userId: string,
  ): Promise<CrewCreditDto> {
    await this.assertEnabled();

    const credit = await this._creditService.create(storyId, dto, userId);
    const [mapped] = this._mapper.toCreditList(
      [credit],
      await this._creditService.findRolesByIds([credit.roleId]),
    );

    return mapped;
  }

  /**
   * Changes a credit's wording or notes.
   *
   * @param creditId - The credit.
   * @param dto - The changes.
   * @param userId - The caller.
   * @returns The updated credit.
   */
  @Patch('credits/:creditId')
  @ApiOperation({ summary: 'Reword a credit' })
  @ApiOkResponse({ type: CrewCreditDto })
  async updateCredit(
    @Param('creditId', ParseUUIDPipe) creditId: string,
    @Body() dto: UpdateCrewCreditDto,
    @UserId() userId: string,
  ): Promise<CrewCreditDto> {
    await this.assertEnabled();

    const credit = await this._creditService.update(creditId, dto, userId);
    const [mapped] = this._mapper.toCreditList(
      [credit],
      await this._creditService.findRolesByIds([credit.roleId]),
    );

    return mapped;
  }

  /**
   * Removes a credit.
   *
   * @param creditId - The credit.
   * @param userId - The caller.
   */
  @Delete('credits/:creditId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a credit' })
  @ApiNoContentResponse({ description: 'The credit was removed.' })
  async removeCredit(
    @Param('creditId', ParseUUIDPipe) creditId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this.assertEnabled();

    await this._creditService.remove(creditId, userId);
  }

  /**
   * Requires that Storytime creation is switched on.
   */
  private async assertEnabled(): Promise<void> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );
  }
}
