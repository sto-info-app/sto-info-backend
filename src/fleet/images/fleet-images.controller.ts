import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
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
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { CallerRole } from 'src/auth/user-role.decorator';
import { AssetScanStatusDto } from 'src/file-assets/dto/asset-scan-status.dto';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileSizeExceptionFilter } from 'src/shared/filters/file-size-exception.filter';
// Reused rather than restated, as Custom Tracking reuses them. How a cropped
// image and its description are parsed off the wire is the same problem here,
// and a second copy of those Multer limits would be a second place to drift.
import {
  assertImageSupplied,
  STORYTIME_IMAGE_FIELD,
  STORYTIME_IMAGE_UPLOAD_OPTIONS,
  STORYTIME_IMAGE_UPLOAD_SCHEMA,
} from 'src/storytime/images/storytime-image-upload.options';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { RequiresScopeCapability } from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FleetImageUploadDto } from '../dto/fleet-image-upload.dto';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { FleetArtworkTarget, FleetImageService } from './fleet-image.service';

/** What every one of these routes says when the file is wrong. */
const BAD_IMAGE =
  'No image was supplied, the file is not the format the slot takes, or ' +
  'the crop is smaller than the slot allows.';

/**
 * The banner and the emblem a Community, Fleet or Armada shows.
 *
 * All four scopes' artwork in one controller, for the reason the directory
 * gives: the rule they share is a thing somebody copies the wrong half of
 * when they add a fifth. Here that rule is `scope.images.manage`, held at
 * the scope in the path — a capability of its own rather than a fifth thing
 * settings management lets through, because a banner is the scope's public
 * face and not a claim about who owns it.
 *
 * **An unregistered Fleet is the exception, and it has its own routes.** It
 * has no Community, so there is no scope at which to hold a capability;
 * the rule instead is that an empty slot is open to anybody signed in and a
 * filled one belongs to whoever filled it. Separate routes rather than one
 * route that behaves differently, so nothing reaches a record under the
 * lenient rule that could have been reached under the strict one.
 *
 * Every upload answers `202` with something to ask about. Nothing has
 * changed by the time the request finishes: a scanner has the file, and the
 * scope goes on showing whatever it had until the verdict is in — FC-012.
 */
@ApiTags('Fleet')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
export class FleetImagesController {
  /**
   * Creates an instance of FleetImagesController.
   *
   * @param _imageService - Accepts and withdraws a scope's artwork.
   * @param _featureService - Reports whether the feature is switched on.
   */
  constructor(
    private readonly _imageService: FleetImageService,
    private readonly _featureService: FleetFeatureService,
  ) {}

  /**
   * Sets the wide banner across the top of a Community's page.
   *
   * @param communityId - The Community.
   * @param userId - The caller.
   * @param file - The cropped image.
   * @param dto - The description sent alongside it.
   * @returns The upload to ask about, and how far along it is.
   */
  @Post('fleet-communities/:communityId/banner-image')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, {
    kind: FleetScopeKind.COMMUNITY,
    param: 'communityId',
  })
  @ApiOperation({ summary: 'Set a Community’s banner' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiAcceptedResponse({ type: AssetScanStatusDto })
  @ApiBadRequestResponse({ description: BAD_IMAGE })
  @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
  @ApiForbiddenResponse({ description: 'You may not change its artwork.' })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  async setCommunityBanner(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: FleetImageUploadDto,
  ): Promise<AssetScanStatusDto> {
    return this.set(
      { kind: FleetScopeKind.COMMUNITY, id: communityId },
      FileAssetSlot.BANNER,
      userId,
      file,
      dto,
    );
  }

  /**
   * Removes the banner from a Community.
   *
   * @param communityId - The Community.
   */
  @Delete('fleet-communities/:communityId/banner-image')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, {
    kind: FleetScopeKind.COMMUNITY,
    param: 'communityId',
  })
  @ApiOperation({ summary: 'Remove a Community’s banner' })
  @ApiNoContentResponse({ description: 'Banner removed.' })
  @ApiNotFoundResponse({ description: 'There is no banner there.' })
  async clearCommunityBanner(
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<void> {
    return this.clear(
      { kind: FleetScopeKind.COMMUNITY, id: communityId },
      FileAssetSlot.BANNER,
    );
  }

  /**
   * Sets the square emblem identifying a Community in a listing.
   *
   * @param communityId - The Community.
   * @param userId - The caller.
   * @param file - The cropped image.
   * @param dto - The description sent alongside it.
   * @returns The upload to ask about, and how far along it is.
   */
  @Post('fleet-communities/:communityId/emblem-image')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, {
    kind: FleetScopeKind.COMMUNITY,
    param: 'communityId',
  })
  @ApiOperation({ summary: 'Set a Community’s emblem' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiAcceptedResponse({ type: AssetScanStatusDto })
  @ApiBadRequestResponse({ description: BAD_IMAGE })
  @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
  @ApiForbiddenResponse({ description: 'You may not change its artwork.' })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  async setCommunityEmblem(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: FleetImageUploadDto,
  ): Promise<AssetScanStatusDto> {
    return this.set(
      { kind: FleetScopeKind.COMMUNITY, id: communityId },
      FileAssetSlot.EMBLEM,
      userId,
      file,
      dto,
    );
  }

  /**
   * Removes the emblem from a Community.
   *
   * @param communityId - The Community.
   */
  @Delete('fleet-communities/:communityId/emblem-image')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, {
    kind: FleetScopeKind.COMMUNITY,
    param: 'communityId',
  })
  @ApiOperation({ summary: 'Remove a Community’s emblem' })
  @ApiNoContentResponse({ description: 'Emblem removed.' })
  @ApiNotFoundResponse({ description: 'There is no emblem there.' })
  async clearCommunityEmblem(
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<void> {
    return this.clear(
      { kind: FleetScopeKind.COMMUNITY, id: communityId },
      FileAssetSlot.EMBLEM,
    );
  }

  /**
   * Sets the wide banner across the top of a Fleet's page.
   *
   * @param fleetId - The Fleet.
   * @param userId - The caller.
   * @param file - The cropped image.
   * @param dto - The description sent alongside it.
   * @returns The upload to ask about, and how far along it is.
   */
  @Post('fleet-communities/:communityId/fleets/:fleetId/banner-image')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, {
    kind: FleetScopeKind.FLEET,
    param: 'fleetId',
    communityParam: 'communityId',
  })
  @ApiOperation({ summary: 'Set a Fleet’s banner' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiAcceptedResponse({ type: AssetScanStatusDto })
  @ApiBadRequestResponse({ description: BAD_IMAGE })
  @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
  @ApiForbiddenResponse({ description: 'You may not change its artwork.' })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  async setFleetBanner(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: FleetImageUploadDto,
  ): Promise<AssetScanStatusDto> {
    return this.set(
      { kind: FleetScopeKind.FLEET, id: fleetId },
      FileAssetSlot.BANNER,
      userId,
      file,
      dto,
    );
  }

  /**
   * Removes the banner from a Fleet.
   *
   * @param fleetId - The Fleet.
   */
  @Delete('fleet-communities/:communityId/fleets/:fleetId/banner-image')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, {
    kind: FleetScopeKind.FLEET,
    param: 'fleetId',
    communityParam: 'communityId',
  })
  @ApiOperation({ summary: 'Remove a Fleet’s banner' })
  @ApiNoContentResponse({ description: 'Banner removed.' })
  @ApiNotFoundResponse({ description: 'There is no banner there.' })
  async clearFleetBanner(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
  ): Promise<void> {
    return this.clear(
      { kind: FleetScopeKind.FLEET, id: fleetId },
      FileAssetSlot.BANNER,
    );
  }

  /**
   * Sets the square emblem identifying a Fleet in a listing.
   *
   * @param fleetId - The Fleet.
   * @param userId - The caller.
   * @param file - The cropped image.
   * @param dto - The description sent alongside it.
   * @returns The upload to ask about, and how far along it is.
   */
  @Post('fleet-communities/:communityId/fleets/:fleetId/emblem-image')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, {
    kind: FleetScopeKind.FLEET,
    param: 'fleetId',
    communityParam: 'communityId',
  })
  @ApiOperation({ summary: 'Set a Fleet’s emblem' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiAcceptedResponse({ type: AssetScanStatusDto })
  @ApiBadRequestResponse({ description: BAD_IMAGE })
  @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
  @ApiForbiddenResponse({ description: 'You may not change its artwork.' })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  async setFleetEmblem(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: FleetImageUploadDto,
  ): Promise<AssetScanStatusDto> {
    return this.set(
      { kind: FleetScopeKind.FLEET, id: fleetId },
      FileAssetSlot.EMBLEM,
      userId,
      file,
      dto,
    );
  }

  /**
   * Removes the emblem from a Fleet.
   *
   * @param fleetId - The Fleet.
   */
  @Delete('fleet-communities/:communityId/fleets/:fleetId/emblem-image')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, {
    kind: FleetScopeKind.FLEET,
    param: 'fleetId',
    communityParam: 'communityId',
  })
  @ApiOperation({ summary: 'Remove a Fleet’s emblem' })
  @ApiNoContentResponse({ description: 'Emblem removed.' })
  @ApiNotFoundResponse({ description: 'There is no emblem there.' })
  async clearFleetEmblem(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
  ): Promise<void> {
    return this.clear(
      { kind: FleetScopeKind.FLEET, id: fleetId },
      FileAssetSlot.EMBLEM,
    );
  }

  /**
   * Sets the wide banner across the top of an Armada's page.
   *
   * @param armadaId - The Armada.
   * @param userId - The caller.
   * @param file - The cropped image.
   * @param dto - The description sent alongside it.
   * @returns The upload to ask about, and how far along it is.
   */
  @Post('fleet-communities/:communityId/armadas/:armadaId/banner-image')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, {
    kind: FleetScopeKind.ARMADA,
    param: 'armadaId',
    communityParam: 'communityId',
  })
  @ApiOperation({ summary: 'Set an Armada’s banner' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiAcceptedResponse({ type: AssetScanStatusDto })
  @ApiBadRequestResponse({ description: BAD_IMAGE })
  @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
  @ApiForbiddenResponse({ description: 'You may not change its artwork.' })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  async setArmadaBanner(
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: FleetImageUploadDto,
  ): Promise<AssetScanStatusDto> {
    return this.set(
      { kind: FleetScopeKind.ARMADA, id: armadaId },
      FileAssetSlot.BANNER,
      userId,
      file,
      dto,
    );
  }

  /**
   * Removes the banner from an Armada.
   *
   * @param armadaId - The Armada.
   */
  @Delete('fleet-communities/:communityId/armadas/:armadaId/banner-image')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, {
    kind: FleetScopeKind.ARMADA,
    param: 'armadaId',
    communityParam: 'communityId',
  })
  @ApiOperation({ summary: 'Remove an Armada’s banner' })
  @ApiNoContentResponse({ description: 'Banner removed.' })
  @ApiNotFoundResponse({ description: 'There is no banner there.' })
  async clearArmadaBanner(
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
  ): Promise<void> {
    return this.clear(
      { kind: FleetScopeKind.ARMADA, id: armadaId },
      FileAssetSlot.BANNER,
    );
  }

  /**
   * Sets the square emblem identifying an Armada in a listing.
   *
   * @param armadaId - The Armada.
   * @param userId - The caller.
   * @param file - The cropped image.
   * @param dto - The description sent alongside it.
   * @returns The upload to ask about, and how far along it is.
   */
  @Post('fleet-communities/:communityId/armadas/:armadaId/emblem-image')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, {
    kind: FleetScopeKind.ARMADA,
    param: 'armadaId',
    communityParam: 'communityId',
  })
  @ApiOperation({ summary: 'Set an Armada’s emblem' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiAcceptedResponse({ type: AssetScanStatusDto })
  @ApiBadRequestResponse({ description: BAD_IMAGE })
  @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
  @ApiForbiddenResponse({ description: 'You may not change its artwork.' })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  async setArmadaEmblem(
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: FleetImageUploadDto,
  ): Promise<AssetScanStatusDto> {
    return this.set(
      { kind: FleetScopeKind.ARMADA, id: armadaId },
      FileAssetSlot.EMBLEM,
      userId,
      file,
      dto,
    );
  }

  /**
   * Removes the emblem from an Armada.
   *
   * @param armadaId - The Armada.
   */
  @Delete('fleet-communities/:communityId/armadas/:armadaId/emblem-image')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, {
    kind: FleetScopeKind.ARMADA,
    param: 'armadaId',
    communityParam: 'communityId',
  })
  @ApiOperation({ summary: 'Remove an Armada’s emblem' })
  @ApiNoContentResponse({ description: 'Emblem removed.' })
  @ApiNotFoundResponse({ description: 'There is no emblem there.' })
  async clearArmadaEmblem(
    @Param('armadaId', ParseUUIDPipe) armadaId: string,
  ): Promise<void> {
    return this.clear(
      { kind: FleetScopeKind.ARMADA, id: armadaId },
      FileAssetSlot.EMBLEM,
    );
  }

  /**
   * Sets the banner on a Fleet nobody has registered.
   *
   * @param fleetId - The unregistered Fleet.
   * @param userId - The caller.
   * @param file - The cropped image.
   * @param dto - The description sent alongside it.
   * @returns The upload to ask about, and how far along it is.
   */
  @Post('fleets/:fleetId/banner-image')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Set the banner on an unregistered Fleet',
    description:
      'For records nobody has registered. An empty slot may be filled by ' +
      'anybody signed in; a filled one may only be changed by whoever ' +
      'filled it. A Fleet that belongs to a Community is reported as ' +
      'missing here and is reached through that Community.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiAcceptedResponse({ type: AssetScanStatusDto })
  @ApiBadRequestResponse({ description: BAD_IMAGE })
  @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
  @ApiForbiddenResponse({
    description: 'Somebody else put that picture there.',
  })
  @ApiNotFoundResponse({ description: 'There is no such unregistered Fleet.' })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  async setUnclaimedFleetBanner(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: FleetImageUploadDto,
  ): Promise<AssetScanStatusDto> {
    await this._featureService.assertEnabled();
    assertImageSupplied(file);

    return this._imageService.setUnclaimedFleetArtwork(
      fleetId,
      FileAssetSlot.BANNER,
      { userId, altText: dto.altText, file },
    );
  }

  /**
   * Removes the banner from a Fleet nobody has registered.
   *
   * @param fleetId - The unregistered Fleet.
   * @param userId - The caller.
   * @param role - What the caller is on the site.
   */
  @Delete('fleets/:fleetId/banner-image')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the banner from an unregistered Fleet' })
  @ApiNoContentResponse({ description: 'Banner removed.' })
  @ApiForbiddenResponse({
    description: 'Somebody else put that picture there.',
  })
  @ApiNotFoundResponse({ description: 'There is no banner there.' })
  async clearUnclaimedFleetBanner(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @CallerRole() role: UserRole | null,
  ): Promise<void> {
    await this._featureService.assertEnabled();

    await this._imageService.clearUnclaimedFleetArtwork(
      fleetId,
      FileAssetSlot.BANNER,
      { userId, role },
    );
  }

  /**
   * Sets the emblem on a Fleet nobody has registered.
   *
   * @param fleetId - The unregistered Fleet.
   * @param userId - The caller.
   * @param file - The cropped image.
   * @param dto - The description sent alongside it.
   * @returns The upload to ask about, and how far along it is.
   */
  @Post('fleets/:fleetId/emblem-image')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Set the emblem on an unregistered Fleet' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiAcceptedResponse({ type: AssetScanStatusDto })
  @ApiBadRequestResponse({ description: BAD_IMAGE })
  @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
  @ApiForbiddenResponse({
    description: 'Somebody else put that picture there.',
  })
  @ApiNotFoundResponse({ description: 'There is no such unregistered Fleet.' })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  async setUnclaimedFleetEmblem(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: FleetImageUploadDto,
  ): Promise<AssetScanStatusDto> {
    await this._featureService.assertEnabled();
    assertImageSupplied(file);

    return this._imageService.setUnclaimedFleetArtwork(
      fleetId,
      FileAssetSlot.EMBLEM,
      { userId, altText: dto.altText, file },
    );
  }

  /**
   * Removes the emblem from a Fleet nobody has registered.
   *
   * @param fleetId - The unregistered Fleet.
   * @param userId - The caller.
   * @param role - What the caller is on the site.
   */
  @Delete('fleets/:fleetId/emblem-image')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the emblem from an unregistered Fleet' })
  @ApiNoContentResponse({ description: 'Emblem removed.' })
  @ApiForbiddenResponse({
    description: 'Somebody else put that picture there.',
  })
  @ApiNotFoundResponse({ description: 'There is no emblem there.' })
  async clearUnclaimedFleetEmblem(
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @UserId() userId: string,
    @CallerRole() role: UserRole | null,
  ): Promise<void> {
    await this._featureService.assertEnabled();

    await this._imageService.clearUnclaimedFleetArtwork(
      fleetId,
      FileAssetSlot.EMBLEM,
      { userId, role },
    );
  }

  /**
   * Sends one of a scope's artwork slots to be scanned.
   *
   * @param target - Which scope.
   * @param slot - The banner or the emblem.
   * @param userId - The caller.
   * @param file - Whatever Multer parsed, if anything.
   * @param dto - The description sent alongside it.
   * @returns The upload to ask about, and how far along it is.
   */
  private async set(
    target: FleetArtworkTarget,
    slot: FileAssetSlot,
    userId: string,
    file: Express.Multer.File | undefined,
    dto: FleetImageUploadDto,
  ): Promise<AssetScanStatusDto> {
    await this._featureService.assertEnabled();
    assertImageSupplied(file);

    return this._imageService.setArtwork(target, slot, {
      userId,
      altText: dto.altText,
      file,
    });
  }

  /**
   * Takes one of a scope's artwork slots back to empty.
   *
   * @param target - Which scope.
   * @param slot - The banner or the emblem.
   */
  private async clear(
    target: FleetArtworkTarget,
    slot: FileAssetSlot,
  ): Promise<void> {
    await this._featureService.assertEnabled();

    await this._imageService.clearArtwork(target, slot);
  }
}
