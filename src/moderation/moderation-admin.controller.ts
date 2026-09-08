import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
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

import { DisableUserDto } from './dto/disable-user.dto';
import {
  ModeratedUserDto,
  PaginatedModeratedUsersDto,
} from './dto/moderated-user.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ModeratedUserQueryDto } from './dto/user-query.dto';
import { PaginatedReportsDto, UserReportDto } from './dto/user-report.dto';
import { ReportService } from './report.service';
import { UserModerationService } from './user-moderation.service';

/**
 * The administrator's half of moderation: the report queue and the member
 * accounts it leads to.
 *
 * Every route requires the ADMIN role. This is the only surface in the
 * application that reads reports or changes another member's account state.
 */
@ApiTags('Moderation (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/moderation')
export class ModerationAdminController {
  /**
   * Creates an instance of ModerationAdminController.
   *
   * @param _reportService - The report service.
   * @param _userModerationService - The user moderation service.
   */
  constructor(
    private readonly _reportService: ReportService,
    private readonly _userModerationService: UserModerationService,
  ) {}

  // ----- Reports -----

  /**
   * Lists reports in the moderation queue.
   *
   * @param query - Status, reason, search and pagination options.
   * @returns A page of reports.
   */
  @Get('reports')
  @ApiOperation({ summary: 'List reported members (admin)' })
  @ApiOkResponse({
    description: 'A page of reports.',
    type: PaginatedReportsDto,
  })
  findReports(@Query() query: ReportQueryDto): Promise<PaginatedReportsDto> {
    return this._reportService.findForAdmin(query);
  }

  /**
   * Retrieves a single report.
   *
   * @param reportId - The report to retrieve.
   * @returns The report.
   */
  @Get('reports/:reportId')
  @ApiOperation({ summary: 'Get a report (admin)' })
  @ApiOkResponse({ description: 'The report.', type: UserReportDto })
  @ApiNotFoundResponse({ description: 'No such report exists.' })
  findReport(
    @Param('reportId', ParseUUIDPipe) reportId: string,
  ): Promise<UserReportDto> {
    return this._reportService.findOneForAdmin(reportId);
  }

  /**
   * Records a decision on a report.
   *
   * @param userId - The acting administrator's user ID.
   * @param reportId - The report to update.
   * @param dto - The new status and any notes.
   * @returns The updated report.
   */
  @Patch('reports/:reportId')
  @ApiOperation({ summary: 'Update a report status (admin)' })
  @ApiOkResponse({ description: 'The updated report.', type: UserReportDto })
  @ApiNotFoundResponse({ description: 'No such report exists.' })
  updateReport(
    @UserId() userId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: UpdateReportDto,
  ): Promise<UserReportDto> {
    return this._reportService.updateForAdmin(reportId, userId, dto);
  }

  // ----- Members -----

  /**
   * Lists members, for finding the account behind a report.
   *
   * @param query - Search, disabled filter and pagination options.
   * @returns A page of members.
   */
  @Get('users')
  @ApiOperation({ summary: 'List members (admin)' })
  @ApiOkResponse({
    description: 'A page of members.',
    type: PaginatedModeratedUsersDto,
  })
  findUsers(
    @Query() query: ModeratedUserQueryDto,
  ): Promise<PaginatedModeratedUsersDto> {
    return this._userModerationService.findUsers(query);
  }

  /**
   * Retrieves a single member.
   *
   * @param moderatedUserId - The member to retrieve.
   * @returns The member.
   */
  @Get('users/:moderatedUserId')
  @ApiOperation({ summary: 'Get a member (admin)' })
  @ApiOkResponse({ description: 'The member.', type: ModeratedUserDto })
  @ApiNotFoundResponse({ description: 'No such member exists.' })
  findUser(
    @Param('moderatedUserId', ParseUUIDPipe) moderatedUserId: string,
  ): Promise<ModeratedUserDto> {
    return this._userModerationService.findUser(moderatedUserId);
  }

  /**
   * Disables a member's account, ending their sessions and closing the reports
   * against them.
   *
   * @param userId - The acting administrator's user ID.
   * @param moderatedUserId - The member to disable.
   * @param dto - The reason recorded against the account.
   * @returns The updated member.
   */
  @Post('users/:moderatedUserId/disable')
  @ApiOperation({ summary: 'Disable a member account (admin)' })
  @ApiOkResponse({ description: 'The updated member.', type: ModeratedUserDto })
  @ApiBadRequestResponse({ description: 'The caller addressed themselves.' })
  @ApiForbiddenResponse({ description: 'The target is an administrator.' })
  @ApiNotFoundResponse({ description: 'No such member exists.' })
  disableUser(
    @UserId() userId: string,
    @Param('moderatedUserId', ParseUUIDPipe) moderatedUserId: string,
    @Body() dto: DisableUserDto,
  ): Promise<ModeratedUserDto> {
    return this._userModerationService.disableUser(
      moderatedUserId,
      userId,
      dto,
    );
  }

  /**
   * Restores a disabled member's account.
   *
   * @param userId - The acting administrator's user ID.
   * @param moderatedUserId - The member to restore.
   * @returns The updated member.
   */
  @Post('users/:moderatedUserId/enable')
  @ApiOperation({ summary: 'Restore a member account (admin)' })
  @ApiOkResponse({ description: 'The updated member.', type: ModeratedUserDto })
  @ApiBadRequestResponse({ description: 'The caller addressed themselves.' })
  @ApiForbiddenResponse({ description: 'The target is an administrator.' })
  @ApiNotFoundResponse({ description: 'No such member exists.' })
  enableUser(
    @UserId() userId: string,
    @Param('moderatedUserId', ParseUUIDPipe) moderatedUserId: string,
  ): Promise<ModeratedUserDto> {
    return this._userModerationService.enableUser(moderatedUserId, userId);
  }
}
