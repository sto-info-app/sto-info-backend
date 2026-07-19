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
import { UpdateCharacterReputationProgressDto } from './dto/update-character-reputation-progress.dto';
import { CharacterReputationService } from './character-reputation.service';

@ApiTags('Character Reputation APIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reputation')
export class CharacterReputationController {
  /**
   * Creates an instance of CharacterReputationController.
   *
   * @param _reputationService - The reputation service.
   */
  constructor(
    private readonly _reputationService: CharacterReputationService,
  ) {}

  @Get('list')
  @ApiOkResponse({ description: 'Successfully retrieved reputations.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets the reputation catalog.
   *
   * @returns The result of the operation.
   */
  getReputations() {
    return this._reputationService.getReputations();
  }

  @Get('character/:characterId/summary')
  @ApiOkResponse({ description: 'Successfully retrieved reputation summary.' })
  @ApiBadRequestResponse({ description: 'Failed to retrieve summary.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets the reputation summary.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @returns The result of the operation.
   */
  getSummary(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
  ) {
    return this._reputationService.getSummary(characterId, userId);
  }

  @Get('character/:characterId')
  @ApiOkResponse({ description: 'Successfully retrieved reputation progress.' })
  @ApiBadRequestResponse({ description: 'Failed to retrieve progress.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets reputation progress.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @returns The result of the operation.
   */
  getProgress(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
  ) {
    return this._reputationService.getProgress(characterId, userId);
  }

  @Put('character/:characterId/reputation/:reputationId')
  @ApiOkResponse({ description: 'Successfully updated reputation progress.' })
  @ApiBadRequestResponse({ description: 'Failed to update progress.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Updates reputation progress.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @param reputationId - The reputation id.
   * @param dto - The dto.
   * @returns The result of the operation.
   */
  updateProgress(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
    @Param('reputationId') reputationId: string,
    @Body() dto: UpdateCharacterReputationProgressDto,
  ) {
    return this._reputationService.updateProgress(
      characterId,
      userId,
      reputationId,
      dto,
    );
  }
}
