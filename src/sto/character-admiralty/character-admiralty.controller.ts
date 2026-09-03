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

import { CharacterAdmiraltyService } from './character-admiralty.service';
import { UpdateCharacterAdmiraltyProgressDto } from './dto/update-character-admiralty-progress.dto';

@ApiTags('Character Admiralty APIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admiralty')
export class CharacterAdmiraltyController {
  constructor(private readonly _service: CharacterAdmiraltyService) {}

  @Get('list')
  @ApiOkResponse({ description: 'Successfully retrieved Admiralty campaigns.' })
  getCampaigns() {
    return this._service.getCampaigns();
  }

  @Get('character/:characterId/summary')
  @ApiOkResponse({ description: 'Successfully retrieved Admiralty summary.' })
  @ApiBadRequestResponse({ description: 'Failed to retrieve summary.' })
  getSummary(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
  ) {
    return this._service.getSummary(characterId, userId);
  }

  @Get('character/:characterId')
  @HttpCode(HttpStatus.OK)
  getProgress(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
  ) {
    return this._service.getProgress(characterId, userId);
  }

  @Put('character/:characterId/campaign/:campaignId')
  updateProgress(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
    @Param('campaignId') campaignId: string,
    @Body() dto: UpdateCharacterAdmiraltyProgressDto,
  ) {
    return this._service.updateProgress(characterId, userId, campaignId, dto);
  }
}
