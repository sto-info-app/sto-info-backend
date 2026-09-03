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

import { CharacterRdService } from './character-rd.service';
import { UpdateCharacterRdProgressDto } from './dto/update-character-rd-progress.dto';

@ApiTags('Character R&D APIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rd')
export class CharacterRdController {
  /**
   * Creates an instance of CharacterRdController.
   *
   * @param _rdService - The R&D service.
   */
  constructor(private readonly _rdService: CharacterRdService) {}

  @Get('list')
  @ApiOkResponse({ description: 'Successfully retrieved R&D schools.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets the R&D school catalog.
   *
   * @returns The result of the operation.
   */
  getSchools() {
    return this._rdService.getSchools();
  }

  @Get('character/:characterId/summary')
  @ApiOkResponse({ description: 'Successfully retrieved R&D summary.' })
  @ApiBadRequestResponse({ description: 'Failed to retrieve summary.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets the R&D summary.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @returns The result of the operation.
   */
  getSummary(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
  ) {
    return this._rdService.getSummary(characterId, userId);
  }

  @Get('character/:characterId')
  @ApiOkResponse({ description: 'Successfully retrieved R&D progress.' })
  @ApiBadRequestResponse({ description: 'Failed to retrieve progress.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets R&D progress.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @returns The result of the operation.
   */
  getProgress(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
  ) {
    return this._rdService.getProgress(characterId, userId);
  }

  @Put('character/:characterId/school/:schoolId')
  @ApiOkResponse({ description: 'Successfully updated R&D progress.' })
  @ApiBadRequestResponse({ description: 'Failed to update progress.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Updates R&D progress.
   *
   * @param userId - The user id.
   * @param characterId - The character id.
   * @param schoolId - The school id.
   * @param dto - The dto.
   * @returns The result of the operation.
   */
  updateProgress(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
    @Param('schoolId') schoolId: string,
    @Body() dto: UpdateCharacterRdProgressDto,
  ) {
    return this._rdService.updateProgress(characterId, userId, schoolId, dto);
  }
}
