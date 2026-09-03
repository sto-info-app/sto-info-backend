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

import { CharacterCommendationService } from './character-commendation.service';
import { UpdateCharacterCommendationProgressDto } from './dto/update-character-commendation-progress.dto';

@ApiTags('Character Commendation APIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('commendation')
export class CharacterCommendationController {
  /**
   * Creates an instance of CharacterCommendationController.
   *
   * @param _commendationService - The commendation service.
   */
  constructor(
    private readonly _commendationService: CharacterCommendationService,
  ) {}

  @Get('list')
  @ApiOkResponse({ description: 'Successfully retrieved commendations.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets the commendation catalogue.
   *
   * @returns The result of the operation.
   */
  getCommendations() {
    return this._commendationService.getCommendations();
  }

  @Get('character/:characterId/summary')
  @ApiOkResponse({
    description: 'Successfully retrieved commendation summary.',
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve summary.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets the commendation summary.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @returns The result of the operation.
   */
  getSummary(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
  ) {
    return this._commendationService.getSummary(characterId, userId);
  }

  @Get('character/:characterId')
  @ApiOkResponse({
    description: 'Successfully retrieved commendation progress.',
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve progress.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets commendation progress.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @returns The result of the operation.
   */
  getProgress(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
  ) {
    return this._commendationService.getProgress(characterId, userId);
  }

  @Put('character/:characterId/commendation/:commendationId')
  @ApiOkResponse({ description: 'Successfully updated commendation progress.' })
  @ApiBadRequestResponse({ description: 'Failed to update progress.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Updates commendation progress.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @param commendationId - The commendation id.
   * @param dto - The dto.
   * @returns The result of the operation.
   */
  updateProgress(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
    @Param('commendationId') commendationId: string,
    @Body() dto: UpdateCharacterCommendationProgressDto,
  ) {
    return this._commendationService.updateProgress(
      characterId,
      userId,
      commendationId,
      dto,
    );
  }
}
