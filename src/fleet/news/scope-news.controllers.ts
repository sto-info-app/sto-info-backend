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
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { OptionalUserId, UserId } from 'src/auth/user-id.decorator';
import { AssetScanStatusDto } from 'src/file-assets/dto/asset-scan-status.dto';
import { FileSizeExceptionFilter } from 'src/shared/filters/file-size-exception.filter';
import {
  assertImageSupplied,
  STORYTIME_IMAGE_FIELD,
  STORYTIME_IMAGE_UPLOAD_OPTIONS,
  STORYTIME_IMAGE_UPLOAD_SCHEMA,
} from 'src/storytime/images/storytime-image-upload.options';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import {
  RequiresScopeCapability,
  ScopeSource,
} from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FleetImageUploadDto } from '../dto/fleet-image-upload.dto';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import {
  armadaScope,
  communityScope,
  fleetScope,
  GovernanceScope,
} from '../governance/utilities/governance-scope.utility';
import {
  CreateScopeNewsPostDto,
  ScopeNewsPageDto,
  ScopeNewsPostDto,
  ScopeNewsPostViewDto,
  ScopeNewsQueryDto,
  UpdateScopeNewsPostDto,
} from './dto/scope-news.dto';
import { ScopeNewsService } from './services/scope-news.service';

/** Where one kind of scope's news is addressed. */
interface ScopeNewsRoutes {
  /** The kind of scope. */
  readonly kind: FleetScopeKind;
  /** The route prefix, ending in `/news`. */
  readonly path: string;
  /**
   * The path parameter naming the scope itself: `communityId` for a
   * Community, which then names nothing else.
   */
  readonly param: string;
  /** Names the scope from the Community and the scope's own ID. */
  readonly scopeOf: (communityId: string, id: string) => GovernanceScope;
}

/** What every upload route says when the file is wrong. */
const BAD_IMAGE =
  'No image was supplied, the file is not a format a cover takes, or the ' +
  'crop is smaller than a cover allows.';

const NOT_OPEN = 'The scope is closed or suspended.';

const NOT_HERE = 'No such post here, or the reader may not see it.';

/**
 * Builds the news routes of one kind of scope (FC-027).
 *
 * A Community's, a Fleet's and an Armada's news are the same routes under
 * three prefixes, differing only in which path parameter names the scope. One
 * definition rather than three copies, so a rule — who may read a draft, what
 * a closed scope refuses — cannot be written into two of them and missed in
 * the third. Each subclass below is a real controller, with its own name in
 * the logs and in the API description.
 *
 * Reading is for whoever may see the post, signed in or not. Everything else
 * needs `news.write` at the scope; site administrators take posts down
 * through {@link AdminScopeNewsController} instead.
 *
 * @param routes - Where this kind of scope's news is addressed.
 * @returns The controller class.
 */
function scopeNewsController(routes: ScopeNewsRoutes) {
  const source: ScopeSource =
    routes.kind === FleetScopeKind.COMMUNITY
      ? { kind: routes.kind, param: routes.param }
      : {
          kind: routes.kind,
          param: routes.param,
          communityParam: 'communityId',
        };

  @ApiTags('Fleet news')
  @ApiBearerAuth()
  @Controller(routes.path)
  class ScopeNewsController {
    /**
     * Creates an instance of the controller.
     *
     * @param _featureService - Reports whether the Fleet feature is on.
     * @param _news - Reads and writes the scope's news.
     */
    constructor(
      readonly _featureService: FleetFeatureService,
      readonly _news: ScopeNewsService,
    ) {}

    /**
     * Lists the scope's posts the reader may see.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param userId - The reader, or null when signed out.
     * @param query - Which page, which words, and published or drafts.
     * @returns The page.
     */
    @Get()
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'List a scope’s news' })
    @ApiOkResponse({ type: ScopeNewsPageDto })
    @ApiNotFoundResponse({ description: 'The reader may not see the scope.' })
    @ApiForbiddenResponse({ description: 'Drafts, without news.write.' })
    async list(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @OptionalUserId() userId: string | null,
      @Query() query: ScopeNewsQueryDto,
    ): Promise<ScopeNewsPageDto> {
      await this._featureService.assertEnabled();

      return this._news.list(routes.scopeOf(communityId, id), userId, query);
    }

    /**
     * Reads one post.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param slug - The post's slug.
     * @param userId - The reader, or null when signed out.
     * @returns The post, and what the reader may do.
     */
    @Get(':slug')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'Read a scope’s news post' })
    @ApiOkResponse({ type: ScopeNewsPostViewDto })
    @ApiNotFoundResponse({ description: NOT_HERE })
    async read(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('slug') slug: string,
      @OptionalUserId() userId: string | null,
    ): Promise<ScopeNewsPostViewDto> {
      await this._featureService.assertEnabled();

      return this._news.read(routes.scopeOf(communityId, id), slug, userId);
    }

    /**
     * Writes a new post, as a draft.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param dto - The post.
     * @param userId - The author.
     * @returns The draft.
     */
    @Post()
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.NEWS_WRITE, source)
    @ApiOperation({ summary: 'Write a scope’s news post' })
    @ApiCreatedResponse({ type: ScopeNewsPostDto })
    @ApiConflictResponse({ description: NOT_OPEN })
    async create(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Body() dto: CreateScopeNewsPostDto,
      @UserId() userId: string,
    ): Promise<ScopeNewsPostDto> {
      await this._featureService.assertEnabled();

      return this._news.create(routes.scopeOf(communityId, id), dto, userId);
    }

    /**
     * Changes a post.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param postId - The post.
     * @param dto - What to change.
     * @param userId - The editor.
     * @returns The post as it now is.
     */
    @Patch(':postId')
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.NEWS_WRITE, source)
    @ApiOperation({ summary: 'Change a scope’s news post' })
    @ApiOkResponse({ type: ScopeNewsPostDto })
    @ApiNotFoundResponse({ description: 'No such post here.' })
    @ApiConflictResponse({ description: NOT_OPEN })
    async update(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('postId', ParseUUIDPipe) postId: string,
      @Body() dto: UpdateScopeNewsPostDto,
      @UserId() userId: string,
    ): Promise<ScopeNewsPostDto> {
      await this._featureService.assertEnabled();

      return this._news.update(
        routes.scopeOf(communityId, id),
        postId,
        dto,
        userId,
      );
    }

    /**
     * Publishes a post now.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param postId - The post.
     * @param userId - The caller.
     * @returns The post as it now is.
     */
    @Post(':postId/publish')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.NEWS_WRITE, source)
    @ApiOperation({ summary: 'Publish a scope’s news post' })
    @ApiOkResponse({ type: ScopeNewsPostDto })
    @ApiNotFoundResponse({ description: 'No such post here.' })
    @ApiConflictResponse({ description: NOT_OPEN })
    async publish(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('postId', ParseUUIDPipe) postId: string,
      @UserId() userId: string,
    ): Promise<ScopeNewsPostDto> {
      await this._featureService.assertEnabled();

      return this._news.publish(
        routes.scopeOf(communityId, id),
        postId,
        userId,
      );
    }

    /**
     * Takes a post back to a draft.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param postId - The post.
     * @param userId - The caller.
     * @returns The post as it now is.
     */
    @Post(':postId/unpublish')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.NEWS_WRITE, source)
    @ApiOperation({ summary: 'Unpublish a scope’s news post' })
    @ApiOkResponse({ type: ScopeNewsPostDto })
    @ApiNotFoundResponse({ description: 'No such post here.' })
    @ApiConflictResponse({ description: NOT_OPEN })
    async unpublish(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('postId', ParseUUIDPipe) postId: string,
      @UserId() userId: string,
    ): Promise<ScopeNewsPostDto> {
      await this._featureService.assertEnabled();

      return this._news.unpublish(
        routes.scopeOf(communityId, id),
        postId,
        userId,
      );
    }

    /**
     * Deletes a post.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param postId - The post.
     * @param userId - The caller.
     */
    @Delete(':postId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.NEWS_WRITE, source)
    @ApiOperation({ summary: 'Delete a scope’s news post' })
    @ApiNoContentResponse({ description: 'Deleted.' })
    @ApiNotFoundResponse({ description: 'No such post here.' })
    @ApiConflictResponse({
      description: 'Published, and the scope is closed or suspended.',
    })
    async remove(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('postId', ParseUUIDPipe) postId: string,
      @UserId() userId: string,
    ): Promise<void> {
      await this._featureService.assertEnabled();
      await this._news.remove(routes.scopeOf(communityId, id), postId, userId);
    }

    /**
     * Sends a post's cover to be scanned.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param postId - The post.
     * @param userId - The uploader.
     * @param file - The cropped image.
     * @param dto - What it shows.
     * @returns The upload to ask about, and how far along it is.
     */
    @Post(':postId/cover-image')
    @HttpCode(HttpStatus.ACCEPTED)
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.NEWS_WRITE, source)
    @ApiOperation({ summary: 'Set a scope’s news post cover' })
    @ApiConsumes('multipart/form-data')
    @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
    @ApiAcceptedResponse({ type: AssetScanStatusDto })
    @ApiBadRequestResponse({ description: BAD_IMAGE })
    @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
    @ApiNotFoundResponse({ description: 'No such post here.' })
    @ApiConflictResponse({ description: NOT_OPEN })
    @UseFilters(FileSizeExceptionFilter)
    @UseInterceptors(
      FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
    )
    async setCover(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('postId', ParseUUIDPipe) postId: string,
      @UserId() userId: string,
      @UploadedFile() file: Express.Multer.File | undefined,
      @Body() dto: FleetImageUploadDto,
    ): Promise<AssetScanStatusDto> {
      await this._featureService.assertEnabled();
      assertImageSupplied(file);

      return this._news.setCover(routes.scopeOf(communityId, id), postId, {
        userId,
        altText: dto.altText,
        file,
      });
    }

    /**
     * Takes a post's cover down.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param postId - The post.
     * @param userId - The caller.
     */
    @Delete(':postId/cover-image')
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.NEWS_WRITE, source)
    @ApiOperation({ summary: 'Remove a scope’s news post cover' })
    @ApiNoContentResponse({ description: 'Removed.' })
    @ApiNotFoundResponse({ description: 'No such post here, or no cover.' })
    @ApiConflictResponse({ description: NOT_OPEN })
    async clearCover(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('postId', ParseUUIDPipe) postId: string,
      @UserId() userId: string,
    ): Promise<void> {
      await this._featureService.assertEnabled();
      await this._news.clearCover(
        routes.scopeOf(communityId, id),
        postId,
        userId,
      );
    }
  }

  return ScopeNewsController;
}

/** A Community's own news, not its Fleets' or Armadas'. */
export class CommunityNewsController extends scopeNewsController({
  kind: FleetScopeKind.COMMUNITY,
  path: 'fleet-communities/:communityId/news',
  param: 'communityId',
  scopeOf: communityId => communityScope(communityId),
}) {}

/** A Fleet's news. */
export class FleetNewsController extends scopeNewsController({
  kind: FleetScopeKind.FLEET,
  path: 'fleet-communities/:communityId/fleets/:fleetId/news',
  param: 'fleetId',
  scopeOf: fleetScope,
}) {}

/** An Armada's news. */
export class ArmadaNewsController extends scopeNewsController({
  kind: FleetScopeKind.ARMADA,
  path: 'fleet-communities/:communityId/armadas/:armadaId/news',
  param: 'armadaId',
  scopeOf: armadaScope,
}) {}
