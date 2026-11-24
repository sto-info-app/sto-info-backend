import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { CaptainsLogService } from './captains-log.service';
import { RemoveLogEntryDto } from './dto/log-entry-input.dto';
import { AdminLogEntryView } from './log-entry.view';

/**
 * What a site admin may do with a reported Log entry (sc-1450).
 */
@ApiTags('Admin - Captain’s Log')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/captains-log')
export class CaptainsLogAdminController {
  /**
   * Creates an instance of CaptainsLogAdminController.
   *
   * @param _log - The Captain's Log.
   */
  constructor(private readonly _log: CaptainsLogService) {}

  /**
   * Reads any entry, for a site admin working a report.
   *
   * @param id - The entry.
   * @returns The entry and its author.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Read a Log entry (admin)' })
  @ApiOkResponse({ description: 'The entry.' })
  @ApiNotFoundResponse({ description: 'No such entry.' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminLogEntryView> {
    return this._log.getForAdmin(id);
  }

  /**
   * Removes a reported entry from its author's profile.
   *
   * @param adminUserId - The site admin.
   * @param id - The entry.
   * @param dto - Why.
   * @returns The entry as it now is.
   */
  @Post(':id/remove')
  @ApiOperation({ summary: 'Remove a Log entry (admin)' })
  @ApiOkResponse({ description: 'The entry, removed.' })
  @ApiNotFoundResponse({ description: 'No such entry.' })
  @ApiConflictResponse({ description: 'It was removed already.' })
  remove(
    @UserId() adminUserId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveLogEntryDto,
  ): Promise<AdminLogEntryView> {
    return this._log.removeForAdmin(adminUserId, id, dto.reason);
  }
}
