import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Response } from 'express';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetFeatureService } from '../fleet-feature.service';
import {
  ChatReportDecisionDto,
  ChatReportDetailDto,
  ChatReportDto,
  ChatReportPageDto,
  ChatReportRemovalDto,
  ChatReportsQueryDto,
} from './dto/chat-report.dto';
import {
  ChatTranscriptDto,
  ChatTranscriptRequestDto,
} from './dto/chat-transcript.dto';
import { ChatReportService } from './reporting/chat-report.service';
import { ChatTranscriptService } from './transcripts/chat-transcript.service';

/**
 * Transcripts and reports, from chat itself (FC-035): a scope admin's
 * transcripts of their channels, and a reader's report of a message.
 */
@ApiTags('Fleet chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatSafetyController {
  /**
   * Creates an instance of ChatSafetyController.
   *
   * @param _featureService - Reports whether chat is switched on.
   * @param _transcripts - Transcripts.
   * @param _reports - Reports.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _transcripts: ChatTranscriptService,
    private readonly _reports: ChatReportService,
  ) {}

  /**
   * Asks for a transcript of a channel.
   *
   * @param channelId - The channel.
   * @param userId - The caller.
   * @param dto - The range, within the last seven days, and the purpose.
   * @returns The transcript, waiting to be written.
   */
  @Post('channels/:channelId/transcripts')
  @ApiOperation({ summary: 'Ask for a chat transcript' })
  @ApiOkResponse({ type: ChatTranscriptDto })
  @ApiForbiddenResponse({ description: 'Not theirs to export.' })
  async requestTranscript(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @UserId() userId: string,
    @Body() dto: ChatTranscriptRequestDto,
  ): Promise<ChatTranscriptDto> {
    await this.assertEnabled();

    return this._transcripts.request(channelId, userId, dto);
  }

  /**
   * Lists the transcripts the caller asked for in the last day.
   *
   * @param userId - The caller.
   * @returns Each, newest first.
   */
  @Get('transcripts')
  @ApiOperation({ summary: 'List your chat transcripts' })
  @ApiOkResponse({ type: [ChatTranscriptDto] })
  async transcripts(@UserId() userId: string): Promise<ChatTranscriptDto[]> {
    await this.assertEnabled();

    return this._transcripts.mine(userId);
  }

  /**
   * Downloads a transcript, never cached.
   *
   * @param transcriptId - The transcript.
   * @param userId - The caller, who asked for it.
   * @param response - Takes the headers.
   * @returns Its text.
   */
  @Get('transcripts/:transcriptId/download')
  @ApiOperation({ summary: 'Download a chat transcript' })
  @ApiOkResponse({ description: 'The transcript, as plain text.' })
  @ApiNotFoundResponse({ description: 'Not theirs.' })
  @ApiConflictResponse({ description: 'Not written yet.' })
  @ApiGoneResponse({ description: 'Its link has expired.' })
  @ApiForbiddenResponse({ description: 'No longer theirs to export.' })
  async download(
    @Param('transcriptId', ParseUUIDPipe) transcriptId: string,
    @UserId() userId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    await this.assertEnabled();

    const transcript = await this._transcripts.download(transcriptId, userId);

    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${transcript.filename}"`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (transcript.byteCount !== null) {
      response.setHeader('Content-Length', String(transcript.byteCount));
    }

    return new StreamableFile(transcript.stream);
  }

  /**
   * Reports a message to the site's admins.
   *
   * @param messageId - The message.
   * @param userId - The caller.
   * @param dto - Why.
   */
  @Post('messages/:messageId/report')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Report a chat message' })
  @ApiConflictResponse({ description: 'Reported by them already.' })
  async report(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @UserId() userId: string,
    @Body() dto: ChatReportDto,
  ): Promise<void> {
    await this.assertEnabled();
    await this._reports.report(messageId, userId, dto);
  }

  /**
   * Refuses while chat is switched off.
   *
   * @throws NotFoundException when it is.
   */
  private async assertEnabled(): Promise<void> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.CHAT_ENABLED,
    );
  }
}

/**
 * The site admins' queue of chat reports (FC-035). Every route needs the
 * ADMIN role, and none needs chat switched on, so reports made before it was
 * switched off can still be closed.
 */
@ApiTags('Moderation (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/chat-reports')
export class ChatReportAdminController {
  /**
   * Creates an instance of ChatReportAdminController.
   *
   * @param _reports - Reports.
   */
  constructor(private readonly _reports: ChatReportService) {}

  /**
   * Lists reports, oldest first.
   *
   * @param query - The filters and the page.
   * @returns A page.
   */
  @Get()
  @ApiOperation({ summary: 'List chat reports (admin)' })
  @ApiOkResponse({ type: ChatReportPageDto })
  list(@Query() query: ChatReportsQueryDto): Promise<ChatReportPageDto> {
    return this._reports.list(query);
  }

  /**
   * Reads a report and its evidence.
   *
   * @param reportId - The report.
   * @returns It.
   */
  @Get(':reportId')
  @ApiOperation({ summary: 'Get a chat report (admin)' })
  @ApiOkResponse({ type: ChatReportDetailDto })
  @ApiNotFoundResponse({ description: 'No such report.' })
  detail(
    @Param('reportId', ParseUUIDPipe) reportId: string,
  ): Promise<ChatReportDetailDto> {
    return this._reports.detail(reportId);
  }

  /**
   * Resolves or dismisses a report.
   *
   * @param reportId - The report.
   * @param userId - The admin.
   * @param dto - The outcome and a note.
   * @returns The report.
   */
  @Post(':reportId/decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve or dismiss a chat report (admin)' })
  @ApiOkResponse({ type: ChatReportDetailDto })
  @ApiConflictResponse({ description: 'Closed already.' })
  decide(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @UserId() userId: string,
    @Body() dto: ChatReportDecisionDto,
  ): Promise<ChatReportDetailDto> {
    return this._reports.decide(reportId, userId, dto);
  }

  /**
   * Removes the reported message.
   *
   * @param reportId - The report.
   * @param userId - The admin.
   * @param dto - Why.
   * @returns The report.
   */
  @Post(':reportId/remove-message')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a reported chat message (admin)' })
  @ApiOkResponse({ type: ChatReportDetailDto })
  @ApiConflictResponse({ description: 'The message is already gone.' })
  removeMessage(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @UserId() userId: string,
    @Body() dto: ChatReportRemovalDto,
  ): Promise<ChatReportDetailDto> {
    return this._reports.removeMessage(reportId, userId, dto);
  }
}
