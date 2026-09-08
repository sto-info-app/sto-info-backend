import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { CreateUserReportDto } from './dto/create-user-report.dto';
import { ReportService } from './report.service';

/**
 * The member's half of moderation: raising a report about another member.
 *
 * There is deliberately nothing to read here. A reporter submits and is told it
 * was received; everything after that happens in the admin queue, and the
 * reported member is never told a report exists.
 */
@ApiTags('Moderation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ModerationController {
  /**
   * Creates an instance of ModerationController.
   *
   * @param _reportService - The report service.
   */
  constructor(private readonly _reportService: ReportService) {}

  /**
   * Reports a member to the site's administrators.
   *
   * @param userId - The authenticated user's ID.
   * @param dto - The member to report, the category and the details.
   */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Report a member' })
  @ApiNoContentResponse({ description: 'The report was received.' })
  @ApiBadRequestResponse({ description: 'The caller addressed themselves.' })
  @ApiNotFoundResponse({ description: 'No active member matches.' })
  @ApiConflictResponse({
    description: 'The caller already has a report awaiting review.',
  })
  reportMember(
    @UserId() userId: string,
    @Body() dto: CreateUserReportDto,
  ): Promise<void> {
    return this._reportService.reportMember(userId, dto);
  }
}
