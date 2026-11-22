import {
  applyDecorators,
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
import {
  RequiresScopeCapability,
  ScopeSource,
} from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FleetImageUploadDto } from '../dto/fleet-image-upload.dto';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { FleetArtworkTarget, FleetImageService } from './fleet-image.service';

/** What every one of these routes says when the file is wrong. */
const BAD_IMAGE =
  'No image was supplied, the file is not the format the slot takes, or ' +
  'the crop is smaller than the slot allows.';

/** Where a Community's identifier is in its artwork routes. */
const COMMUNITY_SCOPE: ScopeSource = {
  kind: FleetScopeKind.COMMUNITY,
  param: 'communityId',
};

/** Where a Fleet's identifiers are in its artwork routes. */
const FLEET_SCOPE: ScopeSource = {
  kind: FleetScopeKind.FLEET,
  param: 'fleetId',
  communityParam: 'communityId',
};

/** Where an Armada's identifiers are in its artwork routes. */
const ARMADA_SCOPE: ScopeSource = {
  kind: FleetScopeKind.ARMADA,
  param: 'armadaId',
  communityParam: 'communityId',
};

/** What a removal route answers, by the slot it empties. */
const CLEARED_SLOT_RESPONSES = {
  banner: { removed: 'Banner removed.', missing: 'There is no banner there.' },
  emblem: { removed: 'Emblem removed.', missing: 'There is no emblem there.' },
} as const;

/** The artwork slots a route can empty, as the responses name them. */
type ArtworkSlotName = keyof typeof CLEARED_SLOT_RESPONSES;

/**
 * What every artwork upload declares, whoever may make it: a cropped image
 * and its description in, `202` and the scan to ask about out.
 *
 * @returns The combined method decorator.
 */
function AcceptsArtworkUpload(): MethodDecorator {
  return applyDecorators(
    HttpCode(HttpStatus.ACCEPTED),
    ApiConsumes('multipart/form-data'),
    ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA),
    ApiAcceptedResponse({ type: AssetScanStatusDto }),
    ApiBadRequestResponse({ description: BAD_IMAGE }),
    ApiPayloadTooLargeResponse({ description: 'The image is too large.' }),
    UseFilters(FileSizeExceptionFilter),
    UseInterceptors(
      FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
    ),
  );
}

/**
 * What every artwork removal answers: `204`, or `404` when the slot was
 * already empty.
 *
 * @param slot - The slot being emptied.
 * @returns The combined method decorator.
 */
function ClearsArtwork(slot: ArtworkSlotName): MethodDecorator {
  return applyDecorators(
    HttpCode(HttpStatus.NO_CONTENT),
    ApiNoContentResponse({ description: CLEARED_SLOT_RESPONSES[slot].removed }),
    ApiNotFoundResponse({ description: CLEARED_SLOT_RESPONSES[slot].missing }),
  );
}

/**
 * Declares a route setting a registered scope's artwork, open to a caller
 * holding `scope.images.manage` at the scope the path names.
 *
 * @param summary - The operation's summary.
 * @param source - Where the scope's identifiers are in the path.
 * @returns The combined method decorator.
 */
function SetsScopeArtwork(
  summary: string,
  source: ScopeSource,
): MethodDecorator {
  return applyDecorators(
    RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, source),
    ApiOperation({ summary }),
    AcceptsArtworkUpload(),
    ApiForbiddenResponse({ description: 'You may not change its artwork.' }),
  );
}

/**
 * Declares a route emptying one of a registered scope's artwork slots, open
 * to a caller holding `scope.images.manage` at the scope the path names.
 *
 * @param summary - The operation's summary.
 * @param source - Where the scope's identifiers are in the path.
 * @param slot - The slot being emptied.
 * @returns The combined method decorator.
 */
function ClearsScopeArtwork(
  summary: string,
  source: ScopeSource,
  slot: ArtworkSlotName,
): MethodDecorator {
  return applyDecorators(
    RequiresScopeCapability(FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE, source),
    ApiOperation({ summary }),
    ClearsArtwork(slot),
  );
}

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
  @SetsScopeArtwork('Set a Community’s banner', COMMUNITY_SCOPE)
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
  @ClearsScopeArtwork('Remove a Community’s banner', COMMUNITY_SCOPE, 'banner')
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
  @SetsScopeArtwork('Set a Community’s emblem', COMMUNITY_SCOPE)
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
  @ClearsScopeArtwork('Remove a Community’s emblem', COMMUNITY_SCOPE, 'emblem')
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
  @SetsScopeArtwork('Set a Fleet’s banner', FLEET_SCOPE)
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
  @ClearsScopeArtwork('Remove a Fleet’s banner', FLEET_SCOPE, 'banner')
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
  @SetsScopeArtwork('Set a Fleet’s emblem', FLEET_SCOPE)
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
  @ClearsScopeArtwork('Remove a Fleet’s emblem', FLEET_SCOPE, 'emblem')
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
  @SetsScopeArtwork('Set an Armada’s banner', ARMADA_SCOPE)
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
  @ClearsScopeArtwork('Remove an Armada’s banner', ARMADA_SCOPE, 'banner')
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
  @SetsScopeArtwork('Set an Armada’s emblem', ARMADA_SCOPE)
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
  @ClearsScopeArtwork('Remove an Armada’s emblem', ARMADA_SCOPE, 'emblem')
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
  @ApiOperation({
    summary: 'Set the banner on an unregistered Fleet',
    description:
      'For records nobody has registered. An empty slot may be filled by ' +
      'anybody signed in; a filled one may only be changed by whoever ' +
      'filled it. A Fleet that belongs to a Community is reported as ' +
      'missing here and is reached through that Community.',
  })
  @AcceptsArtworkUpload()
  @ApiForbiddenResponse({
    description: 'Somebody else put that picture there.',
  })
  @ApiNotFoundResponse({ description: 'There is no such unregistered Fleet.' })
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
  @ApiOperation({ summary: 'Remove the banner from an unregistered Fleet' })
  @ClearsArtwork('banner')
  @ApiForbiddenResponse({
    description: 'Somebody else put that picture there.',
  })
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
  @ApiOperation({ summary: 'Set the emblem on an unregistered Fleet' })
  @AcceptsArtworkUpload()
  @ApiForbiddenResponse({
    description: 'Somebody else put that picture there.',
  })
  @ApiNotFoundResponse({ description: 'There is no such unregistered Fleet.' })
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
  @ApiOperation({ summary: 'Remove the emblem from an unregistered Fleet' })
  @ClearsArtwork('emblem')
  @ApiForbiddenResponse({
    description: 'Somebody else put that picture there.',
  })
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
