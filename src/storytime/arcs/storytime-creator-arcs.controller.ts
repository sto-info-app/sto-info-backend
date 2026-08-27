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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { ArcMembershipDto, ManagedArcDto } from './dto/arc.dto';
import { CreateArcDto } from './dto/create-arc.dto';
import {
  ArcStoryDto,
  ReorderArcStoriesDto,
  UpdateArcDto,
} from './dto/update-arc.dto';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcMembershipService } from './storytime-arc-membership.service';
import { StorytimeArcMapper } from './storytime-arc.mapper';
import { StorytimeArcService } from './storytime-arc.service';

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
   * @param _storyService - Resolves the Stories a membership names.
   * @param _mapper - Maps Arcs to their response shapes.
   * @param _storyMapper - Maps those Stories to their reader-facing shape.
   * @param _featureService - Reports whether creation is switched on.
   */
  constructor(
    private readonly _arcService: StorytimeArcService,
    private readonly _membershipService: StorytimeArcMembershipService,
    private readonly _storyService: StorytimeStoryService,
    private readonly _mapper: StorytimeArcMapper,
    private readonly _storyMapper: StorytimeStoryMapper,
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

    return this.withStories(
      await this._membershipService.findByArcForCurator(arcId, userId),
    );
  }

  /**
   * Invites a Story into an Arc.
   *
   * @param arcId - The Arc.
   * @param dto - The Story to invite.
   * @param userId - The caller.
   * @returns The invitation, waiting on the Story's owner.
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

    return this.withStories([
      await this._membershipService.invite(arcId, dto.storyId, userId),
    ]);
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

    return this.withStories(
      await this._membershipService.reorder(arcId, dto.membershipIds, userId),
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
   * Pairs memberships with the Stories a reader may see.
   *
   * @param memberships - The memberships.
   * @returns The memberships with their Stories.
   */
  private async withStories(
    memberships: StorytimeArcStoryEntity[],
  ): Promise<ArcMembershipDto[]> {
    const stories = await this._storyService.findPublicByIds(
      memberships.map(membership => membership.storyId),
    );

    return this._mapper.toMembershipList(
      memberships,
      new Map(
        stories.map(story => [story.id, this._storyMapper.toPublic(story)]),
      ),
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
