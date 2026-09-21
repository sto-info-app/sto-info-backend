import {
  BadRequestException,
  Controller,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
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
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { FileSizeExceptionFilter } from 'src/shared/filters/file-size-exception.filter';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { RequiresScopeCapability } from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { StoFleetService } from '../services/sto-fleet.service';
import {
  assertRosterSupplied,
  ROSTER_UPLOAD_FIELD,
  ROSTER_UPLOAD_OPTIONS,
  ROSTER_UPLOAD_SCHEMA,
  rosterExportUnavailableMessage,
} from './constants/roster-upload.constants';
import { RosterImportSourceDto } from './dto/roster-import-source.dto';
import { RosterImportIngressService } from './services/roster-import-ingress.service';

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
 * There is no `GET` here yet. Listing a Fleet's imports and downloading a
 * sanitised source are FC-017's and FC-037's, and both need decisions this
 * ticket does not make — what an investigator may see, and under what audit.
 * An upload that cannot yet be read back is the honest state of the feature
 * while there is no scanner to clear it.
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
   * @param _featureService - Reports whether imports are switched on.
   * @param _fleetService - Reads the Fleet, and with it the platform it is
   *   recorded on.
   */
  constructor(
    private readonly _ingressService: RosterImportIngressService,
    private readonly _featureService: FleetFeatureService,
    private readonly _fleetService: StoFleetService,
  ) {}

  /**
   * Accepts a roster export, discards its officer columns and quarantines
   * what is left.
   *
   * @param communityId - The owning Community, checked by the guard.
   * @param fleetId - The Fleet the export belongs to.
   * @param userId - The uploading user.
   * @param file - The multipart file.
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
  @ApiBadRequestResponse({
    description:
      'The export could not be read, or the Fleet is on a platform the game ' +
      'provides no export for. Where a file was read, the body carries a ' +
      'structural code and, where one applies, the line at fault. It never ' +
      'carries any part of the file.',
  })
  async upload(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<RosterImportSourceDto> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );

    const { platform } = await this._fleetService.findByIdOrFail(
      communityId,
      fleetId,
    );

    if (!platform.providesRosterExport) {
      // Multer has already buffered whatever arrived, so this disposes of it
      // the way the ingress service disposes of a file it rejects. Nothing
      // the game wrote on this platform can be in there, but somebody's
      // roster still might be, and a refusal is exactly the upload one would
      // otherwise be tempted to keep a copy of — ADR-0001.
      file?.buffer.fill(0);

      throw new BadRequestException(
        rosterExportUnavailableMessage(platform.name),
      );
    }

    // After the platform, because the platform is true of the Fleet whether
    // or not anything was attached. Telling somebody to attach a file and
    // then, once they have, that their platform cannot produce one would be
    // two answers to one question.
    assertRosterSupplied(file);

    this._logger.debug(
      `[upload] Roster export received - UserId: ${userId}, ` +
        `CommunityId: ${communityId}, FleetId: ${fleetId}, ` +
        `Bytes: ${file.buffer.length}`,
    );

    const accepted = await this._ingressService.accept({
      fleetId,
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

    const { record, asset } = accepted;

    return {
      id: record.id,
      assetId: record.assetId,
      fleetId: record.fleetId,
      originalFilename: record.originalFilename,
      sourceSha256: record.sourceSha256,
      sanitisedSha256: record.sanitisedSha256,
      sourceByteSize: Number(record.sourceByteSize),
      sanitisedByteSize: Number(record.sanitisedByteSize),
      sourceHeaderShape: record.sourceHeaderShape,
      rowCount: record.rowCount,
      officerTailRowCount: record.officerTailRowCount,
      parserVersion: record.parserVersion,
      state: asset.state,
      retainUntil: asset.retainUntil,
      uploadedAt: record.uploadedAt,
    };
  }
}
