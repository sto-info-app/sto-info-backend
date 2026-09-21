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
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import {
  AcceptCharacterFleetProposalDto,
  CharacterFleetMembershipDto,
  CharacterFleetProposalDto,
  LeaveCharacterFleetDto,
  RecordCharacterFleetDto,
  UpdateCharacterFleetVisibilityDto,
} from './dto/character-fleet.dto';
import { FleetFeatureService } from './fleet-feature.service';
import { CharacterFleetMapper } from './mappers/character-fleet.mapper';
import { CharacterFleetMembershipService } from './services/character-fleet-membership.service';
import { CharacterFleetProposalService } from './services/character-fleet-proposal.service';

/**
 * What a user says about their own Characters' Fleets.
 *
 * Addressed under the Character rather than under a Community, because the
 * record is the owner's and belongs to nobody else's tenancy — the same reason
 * these routes take no capability guard. There is no scope to hold a
 * capability at: the only question is whether the caller owns the Character,
 * and the service answers it inside the transaction that writes.
 *
 * The controller lives in this module rather than in `CharacterModule` for a
 * reason that is about wiring rather than about meaning. ADR-0015 fixes the
 * module direction as imports → file-assets → fleet, and `CharacterModule`
 * reaches `FileAssetsModule`, which imports this one; a Fleet controller in
 * there would close the loop. A Nest route is independent of the module that
 * declares it, so the address still reads the way it should.
 *
 * ## Why the whole feature switch and not a capability flag
 *
 * {@link FleetFeatureService.assertEnabled} rather than a named flag. Personal
 * tracking is not a staged capability in its own right — there is no world in
 * which Fleet Community is on and this is off — and inventing a flag for it
 * would be a switch nobody would ever throw and everybody would have to think
 * about.
 */
@ApiTags('Fleet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('character')
export class CharacterFleetsController {
  /**
   * Creates an instance of CharacterFleetsController.
   *
   * @param _membershipService - Reads and writes personal Fleet history.
   * @param _proposalService - Reads and answers proposals.
   * @param _featureService - Reports whether the feature is switched on.
   * @param _mapper - Turns the records into their API shapes.
   */
  constructor(
    private readonly _membershipService: CharacterFleetMembershipService,
    private readonly _proposalService: CharacterFleetProposalService,
    private readonly _featureService: FleetFeatureService,
    private readonly _mapper: CharacterFleetMapper,
  ) {}

  /**
   * Reads a Character's own Fleet history.
   *
   * @param characterId - The Character to read.
   * @param userId - The authenticated user, who must own it.
   * @returns Every membership, current and past, newest first.
   */
  @Get(':characterId/fleets')
  @ApiOperation({ summary: 'Read a Character’s own Fleet history' })
  @ApiOkResponse({ type: [CharacterFleetMembershipDto] })
  @ApiForbiddenResponse({ description: 'The Character is somebody else’s.' })
  async history(
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @UserId() userId: string,
  ): Promise<CharacterFleetMembershipDto[]> {
    await this._featureService.assertEnabled();

    const memberships = await this._membershipService.listForOwner(
      characterId,
      userId,
    );

    return memberships.map(membership =>
      this._mapper.toMembershipDto(membership),
    );
  }

  /**
   * Records that a Character is, or was, in a Fleet.
   *
   * @param characterId - The Character being recorded against.
   * @param dto - The Fleet, the interval and the audience.
   * @param userId - The authenticated user, who must own the Character.
   * @returns The membership that was written.
   */
  @Post(':characterId/fleets')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a Character’s Fleet' })
  @ApiOkResponse({ type: CharacterFleetMembershipDto })
  @ApiForbiddenResponse({ description: 'The Character is somebody else’s.' })
  async record(
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @Body() dto: RecordCharacterFleetDto,
    @UserId() userId: string,
  ): Promise<CharacterFleetMembershipDto> {
    await this._featureService.assertEnabled();

    const membership = await this._membershipService.record(
      characterId,
      userId,
      {
        fleetId: dto.fleetId,
        validFrom: new Date(dto.validFrom),
        validTo:
          dto.validTo === undefined || dto.validTo === null
            ? null
            : new Date(dto.validTo),
        visibility: dto.visibility,
      },
    );

    return this._mapper.toMembershipDto(membership);
  }

  /**
   * Closes the open membership, because the Character has left the Fleet.
   *
   * A `PATCH` on the current membership rather than a `DELETE`, because
   * nothing is being removed: leaving a Fleet is a fact with a date on it, and
   * the record stays in the owner's history saying so.
   *
   * @param characterId - The Character leaving.
   * @param dto - When it ended, or nothing for now.
   * @param userId - The authenticated user, who must own the Character.
   * @returns The membership as it now stands.
   */
  @Patch(':characterId/fleets/current')
  @ApiOperation({ summary: 'Record that a Character has left their Fleet' })
  @ApiOkResponse({ type: CharacterFleetMembershipDto })
  @ApiForbiddenResponse({ description: 'The Character is somebody else’s.' })
  async leave(
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @Body() dto: LeaveCharacterFleetDto,
    @UserId() userId: string,
  ): Promise<CharacterFleetMembershipDto> {
    await this._featureService.assertEnabled();

    const membership = await this._membershipService.leave(
      characterId,
      userId,
      dto.validTo === undefined ? new Date() : new Date(dto.validTo),
    );

    return this._mapper.toMembershipDto(membership);
  }

  /**
   * Changes who may see one membership.
   *
   * @param characterId - The Character it was recorded against.
   * @param membershipId - The membership to change.
   * @param dto - The audience it should have.
   * @param userId - The authenticated user, who must own the Character.
   * @returns The membership as it now stands.
   */
  @Patch(':characterId/fleets/:membershipId/visibility')
  @ApiOperation({ summary: 'Change who may see one Fleet membership' })
  @ApiOkResponse({ type: CharacterFleetMembershipDto })
  @ApiForbiddenResponse({ description: 'The Character is somebody else’s.' })
  async setVisibility(
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateCharacterFleetVisibilityDto,
    @UserId() userId: string,
  ): Promise<CharacterFleetMembershipDto> {
    await this._featureService.assertEnabled();

    const membership = await this._membershipService.setVisibility(
      characterId,
      membershipId,
      userId,
      dto.visibility,
    );

    return this._mapper.toMembershipDto(membership);
  }

  /**
   * Withdraws a membership that should never have been recorded.
   *
   * The `DELETE` is here and not on the current membership, because this is
   * the one removal that means "this did not happen". Leaving a Fleet is the
   * other route.
   *
   * @param characterId - The Character it was recorded against.
   * @param membershipId - The membership to withdraw.
   * @param userId - The authenticated user, who must own the Character.
   * @returns A promise that resolves when it is gone.
   */
  @Delete(':characterId/fleets/:membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw a Fleet membership recorded in error' })
  @ApiNoContentResponse({ description: 'The membership is withdrawn.' })
  @ApiForbiddenResponse({ description: 'The Character is somebody else’s.' })
  async retract(
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();

    await this._membershipService.retract(characterId, membershipId, userId);
  }

  /**
   * Reads the proposals raised about a Character.
   *
   * @param characterId - The Character to read.
   * @param userId - The authenticated user, who must own it.
   * @returns Every proposal, newest first, with expiry already worked out.
   */
  @Get(':characterId/fleet-proposals')
  @ApiOperation({
    summary: 'Read the Fleet proposals raised about a Character',
  })
  @ApiOkResponse({ type: [CharacterFleetProposalDto] })
  @ApiForbiddenResponse({ description: 'The Character is somebody else’s.' })
  async proposals(
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @UserId() userId: string,
  ): Promise<CharacterFleetProposalDto[]> {
    await this._featureService.assertEnabled();

    const proposals = await this._proposalService.listForOwner(
      characterId,
      userId,
    );

    return proposals.map(proposal => this._mapper.toProposalDto(proposal));
  }

  /**
   * Accepts a proposal, which records the membership it proposed.
   *
   * Answers this proposal and no other. A competing one from a different Fleet
   * stays where it is, to be declined on its own — FC-014's third acceptance
   * criterion.
   *
   * @param characterId - The Character the proposal is about.
   * @param proposalId - The proposal being accepted.
   * @param dto - What the acceptance settles, such as the audience.
   * @param userId - The authenticated user, who must own the Character.
   * @returns The membership the acceptance opened.
   */
  @Post(':characterId/fleet-proposals/:proposalId/accept')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Accept a Fleet proposal' })
  @ApiOkResponse({ type: CharacterFleetMembershipDto })
  @ApiConflictResponse({ description: 'It is expired or already answered.' })
  @ApiForbiddenResponse({ description: 'The Character is somebody else’s.' })
  async accept(
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() dto: AcceptCharacterFleetProposalDto,
    @UserId() userId: string,
  ): Promise<CharacterFleetMembershipDto> {
    await this._featureService.assertEnabled();

    const membership = await this._proposalService.accept(
      characterId,
      proposalId,
      userId,
      { visibility: dto.visibility },
    );

    return this._mapper.toMembershipDto(membership);
  }

  /**
   * Declines a proposal, and only that proposal.
   *
   * @param characterId - The Character the proposal is about.
   * @param proposalId - The proposal being declined.
   * @param userId - The authenticated user, who must own the Character.
   * @returns The proposal as it now stands.
   */
  @Post(':characterId/fleet-proposals/:proposalId/decline')
  @ApiOperation({ summary: 'Decline a Fleet proposal' })
  @ApiOkResponse({ type: CharacterFleetProposalDto })
  @ApiConflictResponse({ description: 'It is expired or already answered.' })
  @ApiForbiddenResponse({ description: 'The Character is somebody else’s.' })
  async decline(
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @UserId() userId: string,
  ): Promise<CharacterFleetProposalDto> {
    await this._featureService.assertEnabled();

    const proposal = await this._proposalService.decline(
      characterId,
      proposalId,
      userId,
    );

    return this._mapper.toProposalDto(proposal);
  }
}
