import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { CharacterSpecializationService } from './character-specialization.service';
import { UpdateCharacterSpecializationProgressDto } from './dto/update-character-specialization-progress.dto';
import { UpdateCharacterSpecializationSlotDto } from './dto/update-character-specialization-slot.dto';

@ApiTags('Character Specialization APIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('specialization')
export class CharacterSpecializationController {
  /**
   * Creates an instance of CharacterSpecializationController.
   *
   * @param _specializationService - The specialization service.
   */
  constructor(
    private readonly _specializationService: CharacterSpecializationService,
  ) {}

  @Get('list')
  @ApiOkResponse({ description: 'Successfully retrieved specializations.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets the captain specialization catalog.
   *
   * @returns The result of the operation.
   */
  getSpecializations() {
    return this._specializationService.getSpecializations();
  }

  @Get('character/:characterId/summary')
  @ApiOkResponse({
    description: 'Successfully retrieved specialization summary.',
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve summary.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets the specialization summary.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @returns The result of the operation.
   */
  getSummary(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
  ) {
    return this._specializationService.getSummary(characterId, userId);
  }

  @Get('character/:characterId')
  @ApiOkResponse({
    description: 'Successfully retrieved specialization progress.',
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve progress.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets specialization progress.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @returns The result of the operation.
   */
  getProgress(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
  ) {
    return this._specializationService.getProgress(characterId, userId);
  }

  @Put('character/:characterId/specialization/:specializationId')
  @ApiOkResponse({
    description: 'Successfully updated specialization progress.',
  })
  @ApiBadRequestResponse({ description: 'Failed to update progress.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Updates the points spent in a specialization.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @param specializationId - The specialization id.
   * @param dto - The dto.
   * @returns The result of the operation.
   */
  updateProgress(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
    @Param('specializationId') specializationId: string,
    @Body() dto: UpdateCharacterSpecializationProgressDto,
  ) {
    return this._specializationService.updateProgress(
      characterId,
      userId,
      specializationId,
      dto,
    );
  }

  @Put('character/:characterId/specialization/:specializationId/slot')
  @ApiOkResponse({ description: 'Successfully updated specialization slot.' })
  @ApiBadRequestResponse({ description: 'Failed to update slot.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Activates or deactivates a specialization in a captain slot.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @param specializationId - The specialization id.
   * @param dto - The dto.
   * @returns The result of the operation.
   */
  updateSlot(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
    @Param('specializationId') specializationId: string,
    @Body() dto: UpdateCharacterSpecializationSlotDto,
  ) {
    return this._specializationService.updateSlot(
      characterId,
      userId,
      specializationId,
      dto,
    );
  }
}
