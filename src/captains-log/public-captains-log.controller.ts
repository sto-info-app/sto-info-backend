import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { Public } from 'src/auth/public.decorator';
import { OptionalUserId } from 'src/auth/user-id.decorator';

import { CaptainsLogService } from './captains-log.service';
import { LogEntryQueryDto } from './dto/log-entry-input.dto';
import { LogEntryPage, PublicLogEntryView } from './log-entry.view';

/**
 * The Captain's entries on a member's public profile (sc-1450). Under
 * `/registry`, so the registry's own rate limit covers it.
 */
@ApiTags('Captain’s Log')
@UseGuards(OptionalJwtAuthGuard)
@Controller('registry/logs')
export class PublicCaptainsLogController {
  /**
   * Creates an instance of PublicCaptainsLogController.
   *
   * @param _log - The Captain's Log.
   */
  constructor(private readonly _log: CaptainsLogService) {}

  /**
   * Lists a member's Captain's entries, newest first.
   *
   * @param username - The member's profile username.
   * @param viewerId - The reader, or null when signed out.
   * @param query - The page.
   * @returns A page of entries.
   */
  @Public()
  @Get(':username')
  @ApiOperation({ summary: 'List a member’s Captain’s Log' })
  @ApiOkResponse({ description: 'A page of Captain’s entries, newest first.' })
  @ApiNotFoundResponse({ description: 'No publicly visible member matches.' })
  list(
    @Param('username') username: string,
    @OptionalUserId() viewerId: string | null,
    @Query() query: LogEntryQueryDto,
  ): Promise<LogEntryPage<PublicLogEntryView>> {
    return this._log.listPublic(username, viewerId, query);
  }
}
