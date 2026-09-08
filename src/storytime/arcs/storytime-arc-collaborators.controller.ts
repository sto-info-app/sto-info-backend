import {
  Body,
  Controller,
  Get,
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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeFeatureService } from '../storytime-feature.service';
import {
  ArcCollaboratorDto,
  InviteArcCollaboratorDto,
} from './dto/invite-arc-collaborator.dto';
import { StorytimeArcCollaboratorService } from './storytime-arc-collaborator.service';
import { StorytimeArcMapper } from './storytime-arc.mapper';

/**
 * Managing who helps assemble an Arc.
 *
 * Mirrors Story collaboration route for route, because the two are the same
 * idea applied to different things and a curator who has learned one should
 * not have to learn the other.
 */
@ApiTags('Storytime (creator)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storytime/manage')
export class StorytimeArcCollaboratorsController {
  /**
   * Creates an instance of StorytimeArcCollaboratorsController.
   *
   * @param _collaboratorService - Arc invitations and their lifecycle.
   * @param _mapper - Maps collaborations to their response shape.
   * @param _featureService - Reports whether creation is switched on.
   */
  constructor(
    private readonly _collaboratorService: StorytimeArcCollaboratorService,
    private readonly _mapper: StorytimeArcMapper,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the collaborators on an Arc.
   *
   * @param arcId - The Arc.
   * @param userId - The caller.
   * @returns The collaborators.
   */
  @Get('arcs/:arcId/collaborators')
  @ApiOperation({ summary: 'List who is helping with an Arc' })
  @ApiOkResponse({ type: [ArcCollaboratorDto] })
  @ApiForbiddenResponse({ description: 'No access to this Arc.' })
  async findByArc(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @UserId() userId: string,
  ): Promise<ArcCollaboratorDto[]> {
    await this.assertEnabled();

    return this._mapper.toArcCollaboratorList(
      await this._collaboratorService.findByArc(arcId, userId),
    );
  }

  /**
   * Lists the Arc invitations waiting on the caller.
   *
   * @param userId - The caller.
   * @returns Their unanswered invitations.
   */
  @Get('arc-collaborations/invitations')
  @ApiOperation({ summary: 'List the Arc invitations waiting on you' })
  @ApiOkResponse({ type: [ArcCollaboratorDto] })
  async findMyInvitations(
    @UserId() userId: string,
  ): Promise<ArcCollaboratorDto[]> {
    await this.assertEnabled();

    return this._mapper.toArcCollaboratorList(
      await this._collaboratorService.findPendingForUser(userId),
    );
  }

  /**
   * Invites somebody to help with an Arc.
   *
   * @param arcId - The Arc.
   * @param dto - Who to invite and what they may do.
   * @param userId - The caller.
   * @returns The invitation.
   */
  @Post('arcs/:arcId/collaborators')
  @ApiOperation({ summary: 'Invite somebody to help with an Arc' })
  @ApiOkResponse({ type: ArcCollaboratorDto })
  @ApiBadRequestResponse({ description: 'Already invited, or the curator.' })
  async invite(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @Body() dto: InviteArcCollaboratorDto,
    @UserId() userId: string,
  ): Promise<ArcCollaboratorDto> {
    await this.assertEnabled();

    return this._mapper.toArcCollaborator(
      await this._collaboratorService.invite(arcId, dto, userId),
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
  @Patch('arc-collaborators/:collaboratorId')
  @ApiOperation({ summary: 'Change what an Arc collaborator may do' })
  @ApiOkResponse({ type: ArcCollaboratorDto })
  async update(
    @Param('collaboratorId', ParseUUIDPipe) collaboratorId: string,
    @Body() dto: Partial<InviteArcCollaboratorDto>,
    @UserId() userId: string,
  ): Promise<ArcCollaboratorDto> {
    await this.assertEnabled();

    return this._mapper.toArcCollaborator(
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
  @Post('arc-collaborators/:collaboratorId/accept')
  @ApiOperation({ summary: 'Accept an invitation to help with an Arc' })
  @ApiOkResponse({ type: ArcCollaboratorDto })
  @ApiForbiddenResponse({ description: 'Not your invitation.' })
  async accept(
    @Param('collaboratorId', ParseUUIDPipe) collaboratorId: string,
    @UserId() userId: string,
  ): Promise<ArcCollaboratorDto> {
    await this.assertEnabled();

    return this._mapper.toArcCollaborator(
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
  @Post('arc-collaborators/:collaboratorId/decline')
  @ApiOperation({ summary: 'Decline an invitation to help with an Arc' })
  @ApiOkResponse({ type: ArcCollaboratorDto })
  async decline(
    @Param('collaboratorId', ParseUUIDPipe) collaboratorId: string,
    @UserId() userId: string,
  ): Promise<ArcCollaboratorDto> {
    await this.assertEnabled();

    return this._mapper.toArcCollaborator(
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
  @Post('arc-collaborators/:collaboratorId/revoke')
  @ApiOperation({ summary: 'Withdraw, remove, or step down from an Arc' })
  @ApiOkResponse({ type: ArcCollaboratorDto })
  async revoke(
    @Param('collaboratorId', ParseUUIDPipe) collaboratorId: string,
    @UserId() userId: string,
  ): Promise<ArcCollaboratorDto> {
    await this.assertEnabled();

    return this._mapper.toArcCollaborator(
      await this._collaboratorService.revoke(collaboratorId, userId),
    );
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
