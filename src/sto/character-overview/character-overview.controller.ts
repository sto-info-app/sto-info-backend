import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { CharacterOverviewService } from './character-overview.service';

@ApiTags('Character Overview APIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('character-overview')
export class CharacterOverviewController {
  constructor(private readonly _service: CharacterOverviewService) {}

  @Get('character/:characterId/summary')
  @ApiOkResponse({
    description: 'Successfully retrieved every tracker summary for a captain.',
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve summaries.' })
  getSummary(
    @UserId() userId: string,
    @Param('characterId') characterId: string,
  ) {
    return this._service.getSummary(characterId, userId);
  }
}
