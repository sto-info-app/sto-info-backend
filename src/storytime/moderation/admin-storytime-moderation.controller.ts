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
import { PERMISSION_CODES } from 'src/access-control/constants/permission-codes.constants';
import { PermissionsGuard } from 'src/access-control/permissions.guard';
import { RequiresPermission } from 'src/access-control/requires-permission.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { AppealStatus } from '../enums/appeal-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeReportQueryDto } from './dto/create-storytime-report.dto';
import { DecideAppealDto } from './dto/decide-appeal.dto';
import { ModerateContentDto } from './dto/moderate-content.dto';
import {
  ModerationActionDto,
  ModerationAppealDto,
  StorytimeReportDto,
} from './dto/moderation.dto';
import { ResolveStorytimeReportDto } from './dto/resolve-storytime-report.dto';
import { StorytimeAppealService } from './storytime-appeal.service';
import { StorytimeModerationMapper } from './storytime-moderation.mapper';
import { StorytimeModerationService } from './storytime-moderation.service';
import { StorytimeReportService } from './storytime-report.service';

/**
 * The Storytime moderation queue.
 *
 * Gated by the moderation permission rather than by ownership: acting on
 * somebody else's work is the entire job, which is exactly why it is a
 * permission somebody has to be given.
 *
 * Not gated by any feature flag. An environment that has switched Storytime
 * off still has whatever was published before it went off, and taking
 * something down is the one thing that must never depend on a switch.
 */
@ApiTags('Storytime (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/storytime')
export class AdminStorytimeModerationController {
  /**
   * Creates an instance of AdminStorytimeModerationController.
   *
   * @param _reportService - Reports about content.
   * @param _moderationService - Removing, restoring and the audit trail.
   * @param _appealService - Appeals against removals.
   * @param _mapper - Maps records to their response shapes.
   */
  constructor(
    private readonly _reportService: StorytimeReportService,
    private readonly _moderationService: StorytimeModerationService,
    private readonly _appealService: StorytimeAppealService,
    private readonly _mapper: StorytimeModerationMapper,
  ) {}

  /**
   * Lists the reports in the queue.
   *
   * @param query - The status to filter to, if any.
   * @returns The reports, open work first and oldest first within it.
   */
  @Get('reports')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_MODERATE)
  @ApiOperation({ summary: 'List Storytime reports' })
  @ApiOkResponse({ type: [StorytimeReportDto] })
  @ApiForbiddenResponse({ description: 'Caller may not moderate Storytime.' })
  async findReports(
    @Query() query: StorytimeReportQueryDto,
  ): Promise<StorytimeReportDto[]> {
    return this._mapper.toReportList(
      await this._reportService.findForAdmin(query.status),
    );
  }

  /**
   * Reads one report.
   *
   * @param reportId - The report.
   * @returns The report.
   */
  @Get('reports/:reportId')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_MODERATE)
  @ApiOperation({ summary: 'Read one Storytime report' })
  @ApiOkResponse({ type: StorytimeReportDto })
  @ApiNotFoundResponse({ description: 'No report has that identifier.' })
  async findReport(
    @Param('reportId', ParseUUIDPipe) reportId: string,
  ): Promise<StorytimeReportDto> {
    return this._mapper.toReport(
      await this._reportService.findOneOrFail(reportId),
    );
  }

  /**
   * Moves a report along, or closes it.
   *
   * @param reportId - The report.
   * @param dto - The change.
   * @param actingUserId - The administrator.
   * @returns The report after the change.
   */
  @Patch('reports/:reportId')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_MODERATE)
  @ApiOperation({ summary: 'Move a Storytime report along' })
  @ApiOkResponse({ type: StorytimeReportDto })
  @ApiNotFoundResponse({ description: 'No report has that identifier.' })
  async resolveReport(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: ResolveStorytimeReportDto,
    @UserId() actingUserId: string,
  ): Promise<StorytimeReportDto> {
    return this._mapper.toReport(
      await this._reportService.resolve(reportId, dto, actingUserId),
    );
  }

  /**
   * Lists every report about one piece of content.
   *
   * @param targetType - The kind of content.
   * @param targetId - The content.
   * @returns The reports, most recent first.
   */
  @Get('content/:targetType/:targetId/reports')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_MODERATE)
  @ApiOperation({ summary: 'List the reports about one piece of content' })
  @ApiOkResponse({ type: [StorytimeReportDto] })
  async findReportsForTarget(
    @Param('targetType') targetType: StorytimeTargetType,
    @Param('targetId', ParseUUIDPipe) targetId: string,
  ): Promise<StorytimeReportDto[]> {
    return this._mapper.toReportList(
      await this._reportService.findForTarget(targetType, targetId),
    );
  }

  /**
   * Reads what has been done to one piece of content.
   *
   * @param targetType - The kind of content.
   * @param targetId - The content.
   * @returns The history, most recent first.
   */
  @Get('content/:targetType/:targetId/history')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_MODERATE)
  @ApiOperation({ summary: 'Read a piece of content’s moderation history' })
  @ApiOkResponse({ type: [ModerationActionDto] })
  async findHistory(
    @Param('targetType') targetType: StorytimeTargetType,
    @Param('targetId', ParseUUIDPipe) targetId: string,
  ): Promise<ModerationActionDto[]> {
    return this._mapper.toActionList(
      await this._moderationService.findHistory(targetType, targetId),
    );
  }

  /**
   * Removes a piece of content from public view.
   *
   * @param dto - What to remove, why, and what to tell the creator.
   * @param actingUserId - The administrator.
   * @returns The audit entry written.
   */
  @Post('moderation/remove')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_MODERATE)
  @ApiOperation({ summary: 'Remove Storytime content from public view' })
  @ApiOkResponse({ type: ModerationActionDto })
  @ApiBadRequestResponse({ description: 'Already removed.' })
  @ApiNotFoundResponse({ description: 'The content could not be found.' })
  async remove(
    @Body() dto: ModerateContentDto,
    @UserId() actingUserId: string,
  ): Promise<ModerationActionDto> {
    return this._mapper.toAction(
      await this._moderationService.remove(dto, actingUserId),
    );
  }

  /**
   * Puts removed content back.
   *
   * @param dto - What to restore, and what to tell the creator.
   * @param actingUserId - The administrator.
   * @returns The audit entry written.
   */
  @Post('moderation/restore')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_MODERATE)
  @ApiOperation({ summary: 'Restore removed Storytime content' })
  @ApiOkResponse({ type: ModerationActionDto })
  @ApiBadRequestResponse({ description: 'The content was not removed.' })
  @ApiNotFoundResponse({ description: 'The content could not be found.' })
  async restore(
    @Body() dto: ModerateContentDto,
    @UserId() actingUserId: string,
  ): Promise<ModerationActionDto> {
    return this._mapper.toAction(
      await this._moderationService.restore(dto, actingUserId),
    );
  }

  /**
   * Lists the appeals waiting on a decision.
   *
   * @param status - The status to filter to, if any.
   * @returns The appeals, oldest first.
   */
  @Get('appeals')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_MODERATE)
  @ApiOperation({ summary: 'List Storytime appeals' })
  @ApiOkResponse({ type: [ModerationAppealDto] })
  async findAppeals(
    @Query('status') status?: AppealStatus,
  ): Promise<ModerationAppealDto[]> {
    return this._mapper.toAppealList(
      await this._appealService.findForAdmin(status),
    );
  }

  /**
   * Decides an appeal, restoring the content when it is upheld.
   *
   * @param appealId - The appeal.
   * @param dto - The decision.
   * @param actingUserId - The administrator.
   * @returns The decided appeal.
   */
  @Post('appeals/:appealId/decide')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_MODERATE)
  @ApiOperation({ summary: 'Decide a Storytime appeal' })
  @ApiOkResponse({ type: ModerationAppealDto })
  @ApiBadRequestResponse({ description: 'The appeal was already answered.' })
  @ApiNotFoundResponse({ description: 'No appeal has that identifier.' })
  async decideAppeal(
    @Param('appealId', ParseUUIDPipe) appealId: string,
    @Body() dto: DecideAppealDto,
    @UserId() actingUserId: string,
  ): Promise<ModerationAppealDto> {
    return this._mapper.toAppeal(
      await this._appealService.decide(appealId, dto, actingUserId),
    );
  }
}
