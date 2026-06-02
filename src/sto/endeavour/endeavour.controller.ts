import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
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
import { EndeavourProgressQueryDto } from './dto/endeavour-progress-query.dto';
import { UpdateEndeavourProgressDto } from './dto/update-endeavour-progress.dto';
import { EndeavourService } from './endeavour.service';

@ApiTags('Endeavour APIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('endeavour')
export class EndeavourController {
  /**
   * Creates an instance of EndeavourController.
   *
   * @param endeavourService - The endeavour service.
   */
  constructor(private readonly endeavourService: EndeavourService) {}

  @Get('perks')
  @ApiOkResponse({ description: 'Successfully retrieved endeavour perks.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets endeavour perks.
   *
   * @param category - The category.
   * @returns The result of the operation.
   */
  getPerks(@Query('category') category?: 'Space' | 'Ground') {
    return this.endeavourService.getPerks(category);
  }

  @Get('account/:accountId')
  @ApiOkResponse({ description: 'Successfully retrieved endeavour progress.' })
  @ApiBadRequestResponse({ description: 'Failed to retrieve progress.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets endeavour progress.
   *
   * @param userId - The user id.
   * @param accountId - The account id.
   * @param query - The query.
   * @returns The result of the operation.
   */
  getProgress(
    @UserId() userId: string,
    @Param('accountId') accountId: string,
    @Query() query: EndeavourProgressQueryDto,
  ) {
    return this.endeavourService.getProgress(accountId, userId, query);
  }

  @Get('account/:accountId/summary')
  @ApiOkResponse({ description: 'Successfully retrieved endeavour summary.' })
  @ApiBadRequestResponse({ description: 'Failed to retrieve summary.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Gets the endeavour summary.
   *
   * @param userId - The user id.
   * @param accountId - The account id.
   * @returns The result of the operation.
   */
  getSummary(@UserId() userId: string, @Param('accountId') accountId: string) {
    return this.endeavourService.getSummary(accountId, userId);
  }

  @Put('account/:accountId/perk/:perkId')
  @ApiOkResponse({ description: 'Successfully updated endeavour progress.' })
  @ApiBadRequestResponse({ description: 'Failed to update progress.' })
  @HttpCode(HttpStatus.OK)
  /**
   * Updates endeavour progress.
   *
   * @param userId - The user id.
   * @param accountId - The account id.
   * @param perkId - The perk id.
   * @param dto - The dto.
   * @returns The result of the operation.
   */
  updateProgress(
    @UserId() userId: string,
    @Param('accountId') accountId: string,
    @Param('perkId') perkId: string,
    @Body() dto: UpdateEndeavourProgressDto,
  ) {
    return this.endeavourService.updateProgress(accountId, userId, perkId, dto);
  }
}
