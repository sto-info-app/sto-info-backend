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
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileSizeExceptionFilter } from 'src/shared/filters/file-size-exception.filter';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { StorytimeImageUploadDto } from '../images/dto/storytime-image-upload.dto';
import {
  assertImageSupplied,
  STORYTIME_IMAGE_FIELD,
  STORYTIME_IMAGE_UPLOAD_OPTIONS,
  STORYTIME_IMAGE_UPLOAD_SCHEMA,
} from '../images/storytime-image-upload.options';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { ArcMembershipDto, ManagedArcDto } from './dto/arc.dto';
import { CreateArcDto } from './dto/create-arc.dto';
import {
  ArcStoryDto,
  ReorderArcStoriesDto,
  UpdateArcDto,
} from './dto/update-arc.dto';
import { StorytimeArcMembershipPresenter } from './storytime-arc-membership.presenter';
import { StorytimeArcMembershipService } from './storytime-arc-membership.service';
import { StorytimeArcMapper } from './storytime-arc.mapper';
import { ArcImageSlot, StorytimeArcService } from './storytime-arc.service';

/**
 * Curating Arcs.
 *
 * Deliberately behind sign-in alone rather than a creator permission: an Arc
 * is a reading order across other people's Stories, so somebody who reads but
 * does not write has every reason to curate one.
 */
@ApiTags('Storytime (creator)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storytime/manage/arcs')
export class StorytimeCreatorArcsController {
  /**
   * Creates an instance of StorytimeCreatorArcsController.
   *
   * @param _arcService - The Arc service.
   * @param _membershipService - Getting Stories into and out of an Arc.
   * @param _mapper - Maps Arcs to their response shapes.
   * @param _presenter - Pairs memberships with the Stories they name.
   * @param _featureService - Reports whether creation is switched on.
   */
  constructor(
    private readonly _arcService: StorytimeArcService,
    private readonly _membershipService: StorytimeArcMembershipService,
    private readonly _mapper: StorytimeArcMapper,
    private readonly _presenter: StorytimeArcMembershipPresenter,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the Arcs the caller curates.
   *
   * @param userId - The caller.
   * @returns Their Arcs.
   */
  @Get()
  @ApiOperation({ summary: 'List the Arcs you curate' })
  @ApiOkResponse({ type: [ManagedArcDto] })
  async findMine(@UserId() userId: string): Promise<ManagedArcDto[]> {
    await this.assertEnabled();

    return this._mapper.toManagedList(
      await this._arcService.findOwnedByUser(userId),
    );
  }

  /**
   * Retrieves an Arc for editing.
   *
   * @param arcId - The Arc.
   * @param userId - The caller.
   * @returns The Arc.
   */
  @Get(':arcId')
  @ApiOperation({ summary: 'Retrieve an Arc you curate' })
  @ApiOkResponse({ type: ManagedArcDto })
  @ApiForbiddenResponse({ description: 'Not your Arc.' })
  async findOne(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @UserId() userId: string,
  ): Promise<ManagedArcDto> {
    await this.assertEnabled();

    return this._mapper.toManaged(
      await this._arcService.findOwnedOrFail(arcId, userId),
    );
  }

  /**
   * Creates an Arc.
   *
   * @param dto - The Arc to create.
   * @param userId - The caller.
   * @returns The created Arc.
   */
  @Post()
  @ApiOperation({ summary: 'Curate a new Arc' })
  @ApiOkResponse({ type: ManagedArcDto })
  async create(
    @Body() dto: CreateArcDto,
    @UserId() userId: string,
  ): Promise<ManagedArcDto> {
    await this.assertEnabled();

    return this._mapper.toManaged(await this._arcService.create(dto, userId));
  }

  /**
   * Updates an Arc.
   *
   * @param arcId - The Arc.
   * @param dto - The changes.
   * @param userId - The caller.
   * @returns The updated Arc.
   */
  @Patch(':arcId')
  @ApiOperation({ summary: 'Edit an Arc you curate' })
  @ApiOkResponse({ type: ManagedArcDto })
  @ApiConflictResponse({ description: 'The Arc has changed since.' })
  async update(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @Body() dto: UpdateArcDto,
    @UserId() userId: string,
  ): Promise<ManagedArcDto> {
    await this.assertEnabled();

    return this._mapper.toManaged(
      await this._arcService.update(arcId, dto, userId),
    );
  }

  /**
   * Lists everything in an Arc, including what is still waiting on an answer.
   *
   * @param arcId - The Arc.
   * @param userId - The caller.
   * @returns The memberships.
   */
  @Get(':arcId/stories')
  @ApiOperation({ summary: 'List what is in an Arc you curate' })
  @ApiOkResponse({ type: [ArcMembershipDto] })
  async findStories(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @UserId() userId: string,
  ): Promise<ArcMembershipDto[]> {
    await this.assertEnabled();

    return this._presenter.withStories(
      await this._membershipService.findByArcForCurator(arcId, userId),
      userId,
    );
  }

  /**
   * Invites a Story into an Arc.
   *
   * Joins outright when the curator wrote the Story themselves, because there
   * is then nobody left to ask.
   *
   * @param arcId - The Arc.
   * @param dto - The Story to invite.
   * @param userId - The caller.
   * @returns The membership, joined or waiting on the Story's owner.
   */
  @Post(':arcId/stories')
  @ApiOperation({ summary: 'Invite a Story into an Arc you curate' })
  @ApiOkResponse({ type: [ArcMembershipDto] })
  @ApiBadRequestResponse({ description: 'That Story is already in the Arc.' })
  async invite(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @Body() dto: ArcStoryDto,
    @UserId() userId: string,
  ): Promise<ArcMembershipDto[]> {
    await this.assertEnabled();

    return this._presenter.withStories(
      [await this._membershipService.invite(arcId, dto.storyId, userId)],
      userId,
    );
  }

  /**
   * Reorders an Arc's reading order.
   *
   * @param arcId - The Arc.
   * @param dto - Every agreed membership, in reading order.
   * @param userId - The caller.
   * @returns The memberships in their new order.
   */
  @Post(':arcId/stories/reorder')
  @ApiOperation({ summary: 'Reorder the Stories in an Arc you curate' })
  @ApiOkResponse({ type: [ArcMembershipDto] })
  @ApiBadRequestResponse({
    description: 'The order did not list every Story exactly once.',
  })
  async reorder(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @Body() dto: ReorderArcStoriesDto,
    @UserId() userId: string,
  ): Promise<ArcMembershipDto[]> {
    await this.assertEnabled();

    return this._presenter.withStories(
      await this._membershipService.reorder(arcId, dto.membershipIds, userId),
      userId,
    );
  }

  /**
   * Publishes an Arc.
   *
   * @param arcId - The Arc.
   * @param userId - The caller.
   * @returns The published Arc.
   */
  @Post(':arcId/publish')
  @ApiOperation({ summary: 'Publish an Arc you curate' })
  @ApiOkResponse({ type: ManagedArcDto })
  @ApiBadRequestResponse({ description: 'Nothing has agreed to be in it.' })
  async publish(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @UserId() userId: string,
  ): Promise<ManagedArcDto> {
    await this.assertEnabled();

    const approved = await this._membershipService.findApprovedByArc(arcId);

    return this._mapper.toManaged(
      await this._arcService.publish(arcId, userId, approved.length),
    );
  }

  /**
   * Withdraws an Arc from publication.
   *
   * @param arcId - The Arc.
   * @param userId - The caller.
   * @returns The unpublished Arc.
   */
  @Post(':arcId/unpublish')
  @ApiOperation({ summary: 'Withdraw an Arc you curate' })
  @ApiOkResponse({ type: ManagedArcDto })
  async unpublish(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @UserId() userId: string,
  ): Promise<ManagedArcDto> {
    await this.assertEnabled();

    return this._mapper.toManaged(
      await this._arcService.unpublish(arcId, userId),
    );
  }

  /**
   * Sets the wide banner across the top of an Arc page.
   *
   * @param arcId - The Arc.
   * @param userId - The caller.
   * @param file - The cropped image.
   * @param dto - The alternative text sent alongside it.
   * @returns The Arc, carrying its new banner.
   */
  @Post(':arcId/banner-image')
  @ApiOperation({ summary: 'Set the banner on an Arc you curate' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiOkResponse({ type: ManagedArcDto })
  @ApiBadRequestResponse({
    description:
      'No image was supplied, the file is not a JPEG, or the crop is smaller than 2400 by 480.',
  })
  @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  async setBannerImage(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: StorytimeImageUploadDto,
  ): Promise<ManagedArcDto> {
    return this.setImage(
      arcId,
      userId,
      StorytimeImageSlot.ARC_BANNER,
      file,
      dto,
    );
  }

  /**
   * Removes the banner from an Arc.
   *
   * @param arcId - The Arc.
   * @param userId - The caller.
   * @returns The Arc, without a banner.
   */
  @Delete(':arcId/banner-image')
  @ApiOperation({ summary: 'Remove the banner from an Arc you curate' })
  @ApiOkResponse({ type: ManagedArcDto })
  async clearBannerImage(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @UserId() userId: string,
  ): Promise<ManagedArcDto> {
    return this.clearImage(arcId, userId, StorytimeImageSlot.ARC_BANNER);
  }

  /**
   * Sets the square image identifying an Arc in cards and lists.
   *
   * @param arcId - The Arc.
   * @param userId - The caller.
   * @param file - The cropped image.
   * @param dto - The alternative text sent alongside it.
   * @returns The Arc, carrying its new profile image.
   */
  @Post(':arcId/profile-image')
  @ApiOperation({ summary: 'Set the profile image on an Arc you curate' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiOkResponse({ type: ManagedArcDto })
  @ApiBadRequestResponse({
    description:
      'No image was supplied, the file is not a PNG, or the crop is smaller than 300 by 300.',
  })
  @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  async setProfileImage(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: StorytimeImageUploadDto,
  ): Promise<ManagedArcDto> {
    return this.setImage(
      arcId,
      userId,
      StorytimeImageSlot.ARC_PROFILE,
      file,
      dto,
    );
  }

  /**
   * Removes the profile image from an Arc.
   *
   * @param arcId - The Arc.
   * @param userId - The caller.
   * @returns The Arc, without a profile image.
   */
  @Delete(':arcId/profile-image')
  @ApiOperation({ summary: 'Remove the profile image from an Arc you curate' })
  @ApiOkResponse({ type: ManagedArcDto })
  async clearProfileImage(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @UserId() userId: string,
  ): Promise<ManagedArcDto> {
    return this.clearImage(arcId, userId, StorytimeImageSlot.ARC_PROFILE);
  }

  /**
   * Deletes an Arc.
   *
   * @param arcId - The Arc.
   * @param userId - The caller.
   */
  @Delete(':arcId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an Arc you curate' })
  @ApiNoContentResponse({ description: 'The Arc was deleted.' })
  async remove(
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this.assertEnabled();

    await this._arcService.remove(arcId, userId);
  }

  /**
   * Stores an uploaded image against one of an Arc's artwork slots.
   *
   * @param arcId - The Arc.
   * @param userId - The caller.
   * @param slot - Which image is being set.
   * @param file - Whatever Multer parsed, if anything.
   * @param dto - The alternative text sent alongside it.
   * @returns The Arc, carrying its new artwork.
   */
  private async setImage(
    arcId: string,
    userId: string,
    slot: ArcImageSlot,
    file: Express.Multer.File | undefined,
    dto: StorytimeImageUploadDto,
  ): Promise<ManagedArcDto> {
    await this.assertEnabled();
    assertImageSupplied(file);

    return this._mapper.toManaged(
      await this._arcService.setImage(arcId, userId, slot, file, dto.altText),
    );
  }

  /**
   * Takes one of an Arc's artwork slots back to empty.
   *
   * @param arcId - The Arc.
   * @param userId - The caller.
   * @param slot - Which image is being removed.
   * @returns The Arc, without that artwork.
   */
  private async clearImage(
    arcId: string,
    userId: string,
    slot: ArcImageSlot,
  ): Promise<ManagedArcDto> {
    await this.assertEnabled();

    return this._mapper.toManaged(
      await this._arcService.clearImage(arcId, userId, slot),
    );
  }

  /**
   * Requires that Storytime creation is switched on.
   */
  private async assertEnabled(): Promise<void> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );
  }
}
