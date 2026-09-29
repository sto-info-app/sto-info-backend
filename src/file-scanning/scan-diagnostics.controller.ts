import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserRole } from 'src/user/enums/user-role.enum';

import {
  ScanAssetDetailDto,
  ScanDiagnosticsDto,
  ScanRejectionPageDto,
} from './dto/scan-diagnostics.dto';
import { ScanDiagnosticsService } from './services/scan-diagnostics.service';

/**
 * The administrator's view of the file scanning pipeline (FC-003).
 *
 * Totals only. Nothing it returns names an asset, a file, an owner or a
 * signature, which is why it can be shown on a page at all.
 */
@ApiTags('File scanning (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/file-scanning')
export class ScanDiagnosticsController {
  /**
   * Creates an instance of ScanDiagnosticsController.
   *
   * @param _diagnostics - The diagnostics service.
   */
  constructor(private readonly _diagnostics: ScanDiagnosticsService) {}

  /**
   * Reads the scan usage, engine status and backlog.
   *
   * @returns The diagnostics.
   */
  @Get('diagnostics')
  @ApiOperation({
    summary: 'Read scan usage, engine status and backlog (admin)',
  })
  @ApiOkResponse({
    description:
      'Usage over three windows, the engine the latest attempt reported, the ' +
      'request queue and the assets awaiting a verdict. A part is null when ' +
      'its source could not be reached.',
    type: ScanDiagnosticsDto,
  })
  @ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
  read(): Promise<ScanDiagnosticsDto> {
    return this._diagnostics.read();
  }

  /**
   * The assets a scanner or policy refused, newest first (FC-039).
   *
   * @param page - Which page, from 1.
   * @returns The page: codes and engines, never a signature name.
   */
  @Get('rejections')
  @ApiOperation({ summary: 'List refused assets (admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiOkResponse({ type: ScanRejectionPageDto })
  @ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
  rejections(
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
  ): Promise<ScanRejectionPageDto> {
    return this._diagnostics.rejections(Math.max(1, page ?? 1));
  }

  /**
   * One asset's scan outcome (FC-039).
   *
   * @param assetId - The asset.
   * @returns Its rejection code and engine, never a signature name.
   */
  @Get('assets/:assetId')
  @ApiOperation({ summary: "Read one asset's scan outcome (admin)" })
  @ApiOkResponse({ type: ScanAssetDetailDto })
  @ApiNotFoundResponse({ description: 'No such asset.' })
  @ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
  asset(
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ): Promise<ScanAssetDetailDto> {
    return this._diagnostics.asset(assetId);
  }
}
