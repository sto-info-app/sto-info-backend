import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { FLEET_FEATURE_FLAGS } from './constants/fleet-feature.constants';
import { CreateUnregisteredFleetDto } from './dto/create-unregistered-fleet.dto';
import { RegisteredStoFleetDto } from './dto/sto-fleet.dto';
import { FleetFeatureService } from './fleet-feature.service';
import { StoFleetMapper } from './mappers/sto-fleet.mapper';
import { StoFleetService } from './services/sto-fleet.service';

/**
 * Fleets that belong to no Community on this site.
 *
 * Deliberately not nested under `/fleet-communities`, because the record
 * this route makes has no Community to nest under. That is the whole point
 * of it: an imported roster describing a Fleet nobody here runs needs
 * something to attach to, and inventing a Community to hold it would be a
 * fiction that somebody would then hold capabilities at.
 *
 * ## Who may, and what that costs
 *
 * Any signed-in account. There is no scope to check a capability at and no
 * owner to check one against, so the only gate available is having an
 * account at all. The consequence is stated plainly rather than designed
 * around: **nobody can change or close one of these afterwards**, because
 * every mutating route in this feature checks a capability at a scope and
 * an unregistered Fleet resolves to no scope. Correcting one is an
 * administrator's job.
 *
 * ## Why there is no read route here
 *
 * There is nothing to read it by. The slug index and the Armada composite
 * key both require a Community, so an unregistered record has no address.
 * It surfaces in duplicate warnings and in the directory, which is exactly
 * the reach it should have: enough to stop a second person confirming the
 * same Fleet blind, and no more.
 */
@ApiTags('Fleet')
@Controller('fleets')
export class UnregisteredFleetsController {
  /**
   * Creates an instance of UnregisteredFleetsController.
   *
   * @param _fleetService - Confirms the record.
   * @param _featureService - Reports whether the feature is switched on.
   * @param _mapper - Turns a Fleet into its API shapes.
   */
  constructor(
    private readonly _fleetService: StoFleetService,
    private readonly _featureService: FleetFeatureService,
    private readonly _mapper: StoFleetMapper,
  ) {}

  /**
   * Confirms a Fleet that belongs to no Community.
   *
   * @param userId - The caller.
   * @param dto - The name, the platform and the caller's confirmation.
   * @returns The record, and anything that already answered to its name.
   */
  @Post('unregistered')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirm a Fleet that belongs to no Community',
    description:
      'Requires an explicit confirmation flag. The record has no owner, no ' +
      'web address and no capability held at it, so nobody will be able to ' +
      'change or close it afterwards.',
  })
  @ApiCreatedResponse({ type: RegisteredStoFleetDto })
  @ApiBadRequestResponse({
    description:
      'The confirmation was missing, or the platform is not one this site ' +
      'knows about.',
  })
  async confirm(
    @UserId() userId: string,
    @Body() dto: CreateUnregisteredFleetDto,
  ): Promise<RegisteredStoFleetDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.REGISTRATION_ENABLED,
    );

    const registered = await this._fleetService.registerUnregistered(
      dto,
      userId,
    );

    return {
      fleet: this._mapper.toDto(registered.fleet),
      duplicates: registered.duplicates.map(duplicate =>
        this._mapper.toDuplicateDto(duplicate),
      ),
    };
  }
}
