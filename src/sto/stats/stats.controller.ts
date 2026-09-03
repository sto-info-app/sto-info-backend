import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { StatsResponseDto } from './dto/stats-response.dto';
import { StatsService } from './stats.service';

@ApiTags('STO Stats APIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('stats')
export class StatsController {
  /**
   * Creates an instance of StatsController.
   *
   * @param _statsService - The stats service.
   */
  constructor(private readonly _statsService: StatsService) {}

  /**
   * Returns pre-computed statistics for the authenticated user, aggregating
   * across all their STO accounts and characters. Optionally scoped to a
   * single account via the `accountId` query parameter.
   *
   * @param userId Authenticated user ID (injected).
   * @param accountId Optional account ID to scope the stats to a single account.
   * @returns Aggregated stats.
   */
  @Get()
  @ApiOkResponse({
    description: "Successfully retrieved the user's statistics.",
    type: StatsResponseDto,
  })
  @ApiQuery({
    name: 'accountId',
    required: false,
    description:
      'Scope stats to a single STO account. Must belong to the authenticated user.',
  })
  @HttpCode(HttpStatus.OK)
  getStats(
    @UserId() userId: string,
    @Query('accountId') accountId?: string,
  ): Promise<StatsResponseDto> {
    return this._statsService.getStats(userId, accountId);
  }
}
