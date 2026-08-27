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
import { CreateAppealDto } from './dto/create-appeal.dto';
import { CreateStorytimeReportDto } from './dto/create-storytime-report.dto';
import {
  ModerationAppealDto,
  StorytimeReportReceiptDto,
} from './dto/moderation.dto';
import { StorytimeAppealService } from './storytime-appeal.service';
import { StorytimeModerationMapper } from './storytime-moderation.mapper';
import { StorytimeReportService } from './storytime-report.service';

/**
 * What a member may do about content: report it, or appeal their own removal.
 *
 * Both need sign-in. An anonymous report cannot be followed up, cannot be
 * rate-limited by person, and cannot be told what came of it — and an appeal
 * from somebody who is not the author is not an appeal.
 */
@ApiTags('Storytime')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('storytime')
export class StorytimeModerationController {
  /**
   * Creates an instance of StorytimeModerationController.
   *
   * @param _reportService - Reports about content.
   * @param _appealService - Appeals against removals.
   * @param _mapper - Maps records to their response shapes.
   */
  constructor(
    private readonly _reportService: StorytimeReportService,
    private readonly _appealService: StorytimeAppealService,
    private readonly _mapper: StorytimeModerationMapper,
  ) {}

  /**
   * Reports a piece of content.
   *
   * @param dto - What is being reported and why.
   * @param userId - The reporter.
   * @returns A receipt, so the reporter knows it arrived.
   */
  @Post('reports')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_REPORT_CREATE)
  @ApiOperation({ summary: 'Report a piece of Storytime content' })
  @ApiOkResponse({ type: StorytimeReportReceiptDto })
  @ApiBadRequestResponse({ description: 'Already reported by this member.' })
  @ApiNotFoundResponse({ description: 'The content could not be found.' })
  async report(
    @Body() dto: CreateStorytimeReportDto,
    @UserId() userId: string,
  ): Promise<StorytimeReportReceiptDto> {
    return this._mapper.toReceipt(
      await this._reportService.create(dto, userId),
    );
  }

  /**
   * Appeals against something of the caller's being removed.
   *
   * @param dto - What was removed, and what they have to say.
   * @param userId - The creator.
   * @returns The appeal.
   */
  @Post('appeals')
  @ApiOperation({ summary: 'Appeal against a removal' })
  @ApiOkResponse({ type: ModerationAppealDto })
  @ApiBadRequestResponse({ description: 'Already appealed, or not removed.' })
  @ApiForbiddenResponse({ description: 'The content is not the caller’s.' })
  async appeal(
    @Body() dto: CreateAppealDto,
    @UserId() userId: string,
  ): Promise<ModerationAppealDto> {
    return this._mapper.toAppeal(await this._appealService.create(dto, userId));
  }

  /**
   * Lists the caller's own appeals.
   *
   * @param userId - The creator.
   * @returns Their appeals, most recent first.
   */
  @Get('appeals')
  @ApiOperation({ summary: 'List your appeals' })
  @ApiOkResponse({ type: [ModerationAppealDto] })
  async findMyAppeals(
    @UserId() userId: string,
  ): Promise<ModerationAppealDto[]> {
    return this._mapper.toAppealList(
      await this._appealService.findMine(userId),
    );
  }

  /**
   * Takes an appeal back before it is decided.
   *
   * @param appealId - The appeal.
   * @param userId - The creator.
   * @returns The withdrawn appeal.
   */
  @Post('appeals/:appealId/withdraw')
  @ApiOperation({ summary: 'Withdraw an appeal' })
  @ApiOkResponse({ type: ModerationAppealDto })
  @ApiBadRequestResponse({ description: 'The appeal was already decided.' })
  @ApiForbiddenResponse({ description: 'The appeal is not the caller’s.' })
  async withdrawAppeal(
    @Param('appealId', ParseUUIDPipe) appealId: string,
    @UserId() userId: string,
  ): Promise<ModerationAppealDto> {
    return this._mapper.toAppeal(
      await this._appealService.withdraw(appealId, userId),
    );
  }
}
