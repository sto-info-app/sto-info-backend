import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { Response } from 'express';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { PaginatedQueryDto } from 'src/shared/dto/paginated-query.dto';
import { FileSizeExceptionFilter } from 'src/shared/filters/file-size-exception.filter';

import { FleetAuthorisationService } from '../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { RequiresScopeCapability } from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { StoFleetService } from '../services/sto-fleet.service';
import {
  assertRosterSupplied,
  ROSTER_PREVIEW_OPTIONS,
  ROSTER_PREVIEW_SCHEMA,
  ROSTER_UPLOAD_FIELD,
  ROSTER_UPLOAD_OPTIONS,
  ROSTER_UPLOAD_SCHEMA,
  rosterExportUnavailableMessage,
} from './constants/roster-upload.constants';
import { PreviewRosterImportDto } from './dto/preview-roster-import.dto';
import { RosterImportDetailDto } from './dto/roster-import-detail.dto';
import { RosterImportPageDto } from './dto/roster-import-page.dto';
import { RosterImportPreviewDto } from './dto/roster-import-preview.dto';
import { RosterImportSourceDto } from './dto/roster-import-source.dto';
import { UploadRosterImportDto } from './dto/upload-roster-import.dto';
import { RosterImportIngressService } from './services/roster-import-ingress.service';
import { RosterImportPreviewService } from './services/roster-import-preview.service';
import { RosterImportStatusService } from './services/roster-import-status.service';

/** Who may read a Fleet's imports: whoever sends them, and whoever looks into them. */
const IMPORT_READERS = [
  FLEET_CAPABILITIES.ROSTER_IMPORT,
  FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
] as const;

/**
 * Where a roster export enters the site.
 *
 * Nested under the Community so the route itself states the tenancy, which
 * {@link ScopeCapabilityGuard} then checks: a Fleet that belongs to a
 * different Community than the path claims resolves to nothing and the caller
 * is told it does not exist. A flat `/fleets/:id` route would make the
 * Community segment decorative, and a decorative tenancy segment is the shape
 * of most cross-tenant bugs.
 *
 * The capability is `roster.import`, which FC-005 already defines and
 * delegates. Holding it at the Fleet is the whole of the authorisation
 * decision; nothing here re-reads a role, and a CSV never assigns one.
 *
 * Four refusals, in this order, and the order matters:
 *
 * 1. **The feature switch**, which answers `404` rather than "disabled", so a
 *    staged rollout does not advertise what is coming.
 * 2. **The capability**, before a byte of the body has been parsed by
 *    anything of ours.
 * 3. **The platform**, which answers `400` and says why. The game provides a
 *    fleet roster export on some platforms and not others, so on a console
 *    there is no file to send and never was. That is not a staged rollout to
 *    be hidden behind a `404`; it is a fact about the game, and somebody who
 *    has just spent ten minutes looking for the menu deserves to be told it
 *    rather than left with a missing page. It is answered before the file is
 *    read, and deliberately is not one of the {@link RosterCsvRejectionCode}
 *    values: every one of those describes the structure of a file, and this
 *    refusal has not looked at one.
 * 4. **The file itself**, by the privacy parser.
 *
 * `preview` answers the same four and then keeps nothing: it is the dry run
 * the wizard's first step is built on, and it exists because the uploader has
 * to supply a timezone the file does not contain and can supply it wrongly
 * without noticing.
 *
 * The two `GET`s report what became of each upload, to whoever may send one
 * and to whoever investigates them; neither capability implies the other.
 * Only an investigator is shown which rows failed and which other exports an
 * import disagrees with, and even then as lines, columns and codes. There is
 * still no way to read the file: downloading a sanitised source is FC-037's,
 * and it needs a decision this ticket does not make, namely what an
 * investigator may see and under what audit.
 */
@ApiTags('Fleet')
@ApiBearerAuth()
@Controller('fleet-communities/:communityId/fleets/:fleetId/roster-imports')
export class RosterImportsController {
  private readonly _logger = new Logger(RosterImportsController.name);

  /**
   * Creates an instance of RosterImportsController.
   *
   * @param _ingressService - Takes an upload as far as quarantine.
   * @param _previewService - Reads an upload and keeps none of it.
   * @param _featureService - Reports whether imports are switched on.
   * @param _fleetService - Reads the Fleet, and with it the platform it is
   *   recorded on.
   * @param _statusService - Reports what became of each import.
   * @param _authorisationService - Says whether a reader investigates imports.
   */
  constructor(
    private readonly _ingressService: RosterImportIngressService,
    private readonly _previewService: RosterImportPreviewService,
    private readonly _featureService: FleetFeatureService,
    private readonly _fleetService: StoFleetService,
    private readonly _statusService: RosterImportStatusService,
    private readonly _authorisationService: FleetAuthorisationService,
  ) {}

  /**
   * Lists a Fleet's imports, newest first.
   *
   * @param fleetId - The Fleet.
   * @param query - Which page.
   * @returns The page.
   */
  @Get()
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(IMPORT_READERS, {
    kind: FleetScopeKind.FLEET,
    param: 'fleetId',
    communityParam: 'communityId',
  })
  @ApiOperation({ summary: "List this Fleet's roster imports" })
  @ApiOkResponse({ type: RosterImportPageDto })
  async list(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Query() query: PaginatedQueryDto,
  ): Promise<RosterImportPageDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );

    return this._statusService.list(fleetId, query.page, query.pageSize);
  }

  /**
   * Reports one import.
   *
   * @param communityId - The owning Community, checked by the guard.
   * @param fleetId - The Fleet.
   * @param importId - The import.
   * @param userId - The reader.
   * @returns The import, with its row problems and conflicting exports for
   *   an investigator.
   */
  @Get(':importId')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(IMPORT_READERS, {
    kind: FleetScopeKind.FLEET,
    param: 'fleetId',
    communityParam: 'communityId',
  })
  @ApiOperation({ summary: 'Report what became of one roster import' })
  @ApiOkResponse({ type: RosterImportDetailDto })
  @ApiNotFoundResponse({
    description:
      'The Fleet has no such import. An import of another Fleet is ' +
      'reported the same way as one that never existed.',
  })
  async detail(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('importId', ParseUUIDPipe) importId: string,
    @UserId() userId: string,
  ): Promise<RosterImportDetailDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );

    // Resolved once per request already, by the guard, so this is a lookup
    // in what it found rather than a second authorisation.
    const investigator = await this._authorisationService.hasCapability(
      userId,
      {
        kind: FleetScopeKind.FLEET,
        id: fleetId,
        withinCommunityId: communityId,
      },
      FLEET_CAPABILITIES.ROSTER_INVESTIGATE,
    );

    return this._statusService.detail(fleetId, importId, investigator);
  }

  /**
   * Accepts a roster export, discards its officer columns and quarantines
   * what is left.
   *
   * @param communityId - The owning Community, checked by the guard.
   * @param fleetId - The Fleet the export belongs to.
   * @param userId - The uploading user.
   * @param body - The timezone the export was taken in, and the instant its
   *   filename stamp names where the stamp names two.
   * @param file - The multipart file.
   * @param response - Used only to answer a repeat with 200 rather than 201.
   * @returns What was accepted, and what was discarded.
   */
  @Post()
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_IMPORT, {
    kind: FleetScopeKind.FLEET,
    param: 'fleetId',
    communityParam: 'communityId',
  })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(FileInterceptor(ROSTER_UPLOAD_FIELD, ROSTER_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody(ROSTER_UPLOAD_SCHEMA)
  @ApiOperation({ summary: 'Upload an STO roster export for this Fleet' })
  @ApiCreatedResponse({ type: RosterImportSourceDto })
  @ApiOkResponse({
    description:
      'This Fleet has already imported this file, and the import it made is ' +
      'returned unchanged. Nothing new is stored or scanned.',
    type: RosterImportSourceDto,
  })
  @ApiConflictResponse({
    description:
      'This Fleet has already imported this file, read in a different ' +
      'timezone or at a different time. The body carries the code ' +
      'ALREADY_IMPORTED_DIFFERENTLY and the earlier import\u2019s id and ' +
      'reading; the earlier import stands.',
  })
  @ApiBadRequestResponse({
    description:
      'The export could not be read, its filename is not evidence about ' +
      'this Fleet, or the Fleet is on a platform the game provides no ' +
      'export for. Where a file was read, the body carries a structural ' +
      'code and, where one applies, the line at fault; a file whose rows ' +
      'hold values that cannot be read is refused with every row at fault ' +
      'as a line, a column and a code. It never carries any part of the ' +
      'file.',
  })
  async upload(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() body: UploadRosterImportDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RosterImportSourceDto> {
    const fleet = await this.requireImportableFleet(communityId, fleetId, file);

    assertRosterSupplied(file);

    this._logger.debug(
      `[upload] Roster export received - UserId: ${userId}, ` +
        `CommunityId: ${communityId}, FleetId: ${fleetId}, ` +
        `Timezone: ${body.timezone}, Bytes: ${file.buffer.length}`,
    );

    const accepted = await this._ingressService.accept({
      fleet,
      timezone: body.timezone,
      // Validated as an ISO-8601 instant by the DTO, and checked against the
      // two the stamp could have meant by the service. Neither this method
      // nor the DTO is entitled to decide it is the right one.
      chosenExportedAt:
        body.exportedAt === undefined ? null : new Date(body.exportedAt),
      uploadedByUserId: userId,
      originalFilename: file.originalname,
      declaredContentType: file.mimetype ?? null,
      source: file.buffer,
    });

    // The service overwrote the buffer in place. Dropping Multer's reference
    // to it as well means nothing downstream — an interceptor, a Sentry
    // breadcrumb, a request log — can hold a page of zeroes where a roster
    // used to be, let alone anything else.
    file.buffer = Buffer.alloc(0);

    // Nothing was created, so 201 would be a false answer. The body is the
    // import the first upload made, exactly as it would be listed.
    if (accepted.repeated) {
      response.status(HttpStatus.OK);
    }

    // Read back as the listing reads it, so the upload and the listing cannot
    // describe one import two ways.
    return this._statusService.summary(fleetId, accepted.record.id);
  }

  /**
   * Reports how an export would be read, and keeps none of it.
   *
   * The wizard's first step, and a dry run in the strict sense: no asset is
   * registered, no bytes are written, no provenance row exists and no scan is
   * requested. Behind the same four refusals as the upload, in the same order,
   * because a file that could not be uploaded is not a file worth reading.
   *
   * It exists because the uploader has to supply something the file does not
   * contain. An STO export writes wall-clock times with no zone, in the
   * filename and in every date column, and the wrong zone moves every date by
   * hours without looking wrong anywhere. The answer is to show them their own
   * rows read back, before anything is committed to.
   *
   * @param communityId - The owning Community, checked by the guard.
   * @param fleetId - The Fleet the export would belong to.
   * @param userId - The asking user.
   * @param body - The timezone the export was taken in.
   * @param file - The multipart file.
   * @returns How the export would be read.
   */
  @Post('preview')
  @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
  @RequiresScopeCapability(FLEET_CAPABILITIES.ROSTER_IMPORT, {
    kind: FleetScopeKind.FLEET,
    param: 'fleetId',
    communityParam: 'communityId',
  })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(FileInterceptor(ROSTER_UPLOAD_FIELD, ROSTER_PREVIEW_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody(ROSTER_PREVIEW_SCHEMA)
  @ApiOperation({
    summary: 'Check how a roster export would be read, without importing it',
  })
  @ApiOkResponse({ type: RosterImportPreviewDto })
  @ApiBadRequestResponse({
    description:
      'The export could not be read at all, or the Fleet is on a platform ' +
      'the game provides no export for. A file that reads but cannot be ' +
      'trusted is answered with 200 and the reasons, which is the whole ' +
      'point of the screen.',
  })
  @HttpCode(HttpStatus.OK)
  async preview(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @Body() body: PreviewRosterImportDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<RosterImportPreviewDto> {
    const fleet = await this.requireImportableFleet(communityId, fleetId, file);

    assertRosterSupplied(file);

    this._logger.debug(
      `[preview] Roster export received - UserId: ${userId}, ` +
        `CommunityId: ${communityId}, FleetId: ${fleetId}, ` +
        `Timezone: ${body.timezone}, Bytes: ${file.buffer.length}`,
    );

    const preview = await this._previewService.preview({
      fleet,
      originalFilename: file.originalname,
      timezone: body.timezone,
      source: file.buffer,
    });

    // The service overwrote the buffer in place. Dropping Multer's reference
    // as well means nothing downstream can hold a page of zeroes where a
    // roster used to be, let alone anything else.
    file.buffer = Buffer.alloc(0);

    return preview;
  }

  /**
   * Runs the three refusals that precede reading a file, and returns the
   * Fleet.
   *
   * Shared so that the preview and the upload answer the same questions in
   * the same order. An uploader told a file is fine and then told their
   * platform has no export has been told nothing.
   *
   * @param communityId - The owning Community, checked by the guard.
   * @param fleetId - The Fleet.
   * @param file - Whatever Multer parsed, if anything.
   * @returns The Fleet, with its platform.
   * @throws BadRequestException when the platform provides no roster export.
   */
  private async requireImportableFleet(
    communityId: string,
    fleetId: string,
    file: Express.Multer.File | undefined,
  ): Promise<StoFleetEntity> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );

    const fleet = await this._fleetService.findByIdOrFail(communityId, fleetId);

    if (!fleet.platform.providesRosterExport) {
      // Multer has already buffered whatever arrived, so this disposes of it
      // the way the ingress service disposes of a file it rejects. Nothing
      // the game wrote on this platform can be in there, but somebody's
      // roster still might be, and a refusal is exactly the upload one would
      // otherwise be tempted to keep a copy of — ADR-0001.
      file?.buffer.fill(0);

      throw new BadRequestException(
        rosterExportUnavailableMessage(fleet.platform.name),
      );
    }

    return fleet;
  }
}
