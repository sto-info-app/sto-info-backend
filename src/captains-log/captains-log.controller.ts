import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { AssetScanStatusDto } from 'src/file-assets/dto/asset-scan-status.dto';
import { FleetImageUploadDto } from 'src/fleet/dto/fleet-image-upload.dto';
import { FileSizeExceptionFilter } from 'src/shared/filters/file-size-exception.filter';
import {
  assertImageSupplied,
  STORYTIME_IMAGE_FIELD,
  STORYTIME_IMAGE_UPLOAD_OPTIONS,
  STORYTIME_IMAGE_UPLOAD_SCHEMA,
} from 'src/storytime/images/storytime-image-upload.options';

import { CaptainsLogService } from './captains-log.service';
import {
  CreateLogEntryDto,
  LogEntryQueryDto,
  UpdateLogEntryDto,
} from './dto/log-entry-input.dto';
import { LogEntryPage, LogEntryView } from './log-entry.view';

/**
 * A member's own Captain's Log (sc-1450).
 */
@ApiTags('Captain’s Log')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('captains-log')
export class CaptainsLogController {
  /**
   * Creates an instance of CaptainsLogController.
   *
   * @param _log - The Captain's Log.
   */
  constructor(private readonly _log: CaptainsLogService) {}

  /**
   * Lists the caller's own entries, newest first.
   *
   * @param userId - The caller.
   * @param query - The type, if only one, and the page.
   * @returns A page of entries.
   */
  @Get()
  @ApiOperation({ summary: 'List my Log entries' })
  @ApiOkResponse({ description: 'A page of entries, newest first.' })
  list(
    @UserId() userId: string,
    @Query() query: LogEntryQueryDto,
  ): Promise<LogEntryPage<LogEntryView>> {
    return this._log.list(userId, query);
  }

  /**
   * Reads one of the caller's own entries.
   *
   * @param userId - The caller.
   * @param id - The entry.
   * @returns The entry.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Read one of my Log entries' })
  @ApiOkResponse({ description: 'The entry.' })
  @ApiNotFoundResponse({ description: 'No such entry of mine.' })
  get(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LogEntryView> {
    return this._log.get(userId, id);
  }

  /**
   * Writes a new entry.
   *
   * @param userId - The caller.
   * @param dto - The type, headline and body.
   * @returns The entry.
   */
  @Post()
  @ApiOperation({ summary: 'Write a Log entry' })
  @ApiOkResponse({ description: 'The new entry.' })
  @ApiBadRequestResponse({ description: 'The entry is not acceptable.' })
  create(
    @UserId() userId: string,
    @Body() dto: CreateLogEntryDto,
  ): Promise<LogEntryView> {
    return this._log.create(userId, dto);
  }

  /**
   * Changes one of the caller's own entries.
   *
   * @param userId - The caller.
   * @param id - The entry.
   * @param dto - What to change.
   * @returns The entry.
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Edit one of my Log entries' })
  @ApiOkResponse({ description: 'The entry, changed.' })
  @ApiNotFoundResponse({ description: 'No such entry of mine.' })
  @ApiConflictResponse({ description: 'Moderators removed the entry.' })
  update(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLogEntryDto,
  ): Promise<LogEntryView> {
    return this._log.update(userId, id, dto);
  }

  /**
   * Deletes one of the caller's own entries for good.
   *
   * @param userId - The caller.
   * @param id - The entry.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of my Log entries' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiNotFoundResponse({ description: 'No such entry of mine.' })
  remove(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this._log.remove(userId, id);
  }

  /**
   * Sends an entry's picture to be scanned.
   *
   * @param userId - The caller.
   * @param id - The entry.
   * @param file - The cropped image.
   * @param dto - What it shows.
   * @returns The upload to ask about, and how far along it is.
   */
  @Post(':id/picture')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Set a Log entry’s picture' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiAcceptedResponse({ type: AssetScanStatusDto })
  @ApiBadRequestResponse({
    description:
      'No image was supplied, the file is not a format a picture takes, the ' +
      'crop is too small, or the picture is not described.',
  })
  @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
  @ApiNotFoundResponse({ description: 'No such entry of mine.' })
  @ApiConflictResponse({ description: 'Moderators removed the entry.' })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  setPicture(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: FleetImageUploadDto,
  ): Promise<AssetScanStatusDto> {
    assertImageSupplied(file);

    return this._log.setPicture(userId, id, { altText: dto.altText, file });
  }

  /**
   * Takes an entry's picture down.
   *
   * @param userId - The caller.
   * @param id - The entry.
   */
  @Delete(':id/picture')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a Log entry’s picture' })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiNotFoundResponse({ description: 'No such entry, or it has no picture.' })
  clearPicture(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this._log.clearPicture(userId, id);
  }
}
