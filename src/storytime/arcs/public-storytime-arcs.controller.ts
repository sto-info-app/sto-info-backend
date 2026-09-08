import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeTagMapper } from '../tags/storytime-tag.mapper';
import { StorytimeTaggingService } from '../tags/storytime-tagging.service';
import { ArcDto, ArcProgressDto, ArcWithStoriesDto } from './dto/arc.dto';
import { StorytimeArcMembershipService } from './storytime-arc-membership.service';
import { StorytimeArcProgressService } from './storytime-arc-progress.service';
import { StorytimeArcMapper } from './storytime-arc.mapper';
import { StorytimeArcService } from './storytime-arc.service';

/**
 * Reading Arcs, without needing an account.
 *
 * An Arc shows only the Stories that both agreed to be in it and are readable
 * right now. A curator may assemble an Arc around Stories that are not out
 * yet, but a reader should never be shown a place in a reading order they
 * cannot go.
 */
@ApiTags('Storytime')
@Controller('storytime/arcs')
export class PublicStorytimeArcsController {
  /**
   * Creates an instance of PublicStorytimeArcsController.
   *
   * @param _arcService - The Arc service.
   * @param _membershipService - What is agreed to be in an Arc.
   * @param _storyService - Resolves the readable Stories.
   * @param _mapper - Maps Arcs to their response shapes.
   * @param _storyMapper - Maps Stories to their reader-facing shape.
   * @param _taggingService - Reads what an Arc and its Stories are tagged with.
   * @param _tagMapper - Maps those tags to their response shape.
   * @param _progressService - How far a reader has got through the Arc.
   * @param _featureService - Reports whether public reading is switched on.
   */
  constructor(
    private readonly _arcService: StorytimeArcService,
    private readonly _membershipService: StorytimeArcMembershipService,
    private readonly _storyService: StorytimeStoryService,
    private readonly _mapper: StorytimeArcMapper,
    private readonly _storyMapper: StorytimeStoryMapper,
    private readonly _taggingService: StorytimeTaggingService,
    private readonly _tagMapper: StorytimeTagMapper,
    private readonly _progressService: StorytimeArcProgressService,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the Arcs anybody may discover.
   *
   * @returns The public Arcs, newest first.
   */
  @Get()
  @ApiOperation({ summary: 'List published Arcs' })
  @ApiOkResponse({ type: [ArcDto] })
  async findAll(): Promise<ArcDto[]> {
    await this.assertEnabled();

    const arcs = await this._arcService.findPublic();

    // One lookup for the whole listing, the way the Story listing does it: an
    // Arc is chosen from what it is about as much as from its title.
    return this._mapper.toPublicList(
      arcs,
      this._tagMapper.toListsByTarget(
        await this._taggingService.findForMany(
          StorytimeTargetType.ARC,
          arcs.map(arc => arc.id),
        ),
      ),
    );
  }

  /**
   * Reads one Arc, with the Stories a reader can follow through it.
   *
   * @param arcSlug - The Arc slug.
   * @returns The Arc and its readable Stories, in reading order.
   */
  @Get(':arcSlug')
  @ApiOperation({ summary: 'Read a published Arc' })
  @ApiOkResponse({ type: ArcWithStoriesDto })
  @ApiNotFoundResponse({ description: 'No readable Arc matches the slug.' })
  async findOne(@Param('arcSlug') arcSlug: string): Promise<ArcWithStoriesDto> {
    await this.assertEnabled();

    const arc = await this._arcService.findPublicBySlug(arcSlug);

    if (!arc) {
      throw new NotFoundException('Arc not found');
    }

    const memberships = await this._membershipService.findApprovedByArc(arc.id);
    const stories = await this._storyService.findPublicByIds(
      memberships.map(membership => membership.storyId),
    );
    const storyTags = this._tagMapper.toListsByTarget(
      await this._taggingService.findForMany(
        StorytimeTargetType.STORY,
        stories.map(story => story.id),
      ),
    );
    const byId = new Map(
      stories.map(story => [
        story.id,
        this._storyMapper.toPublic(story, null, storyTags.get(story.id) ?? []),
      ]),
    );

    return {
      arc: this._mapper.toPublic(
        arc,
        this._tagMapper.toList(
          await this._taggingService.findFor(StorytimeTargetType.ARC, arc.id),
        ),
      ),
      // Filtered to the Stories that are readable now. A membership naming a
      // Story that is not out yet is a real agreement, but showing it would
      // offer a reader a step they cannot take.
      stories: this._mapper
        .toMembershipList(memberships, byId)
        .filter(membership => membership.story !== null),
    };
  }

  /**
   * Reports the caller's progress through an Arc.
   *
   * Counted over the Stories a reader can actually open, so an Arc whose later
   * Stories are not published yet reads as complete once the published ones
   * are done rather than stalling at a percentage nobody can move.
   *
   * @param arcSlug - The Arc slug.
   * @param userId - The reader.
   * @returns Their progress across the Arc.
   */
  @Get(':arcSlug/progress')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Report your progress through an Arc' })
  @ApiOkResponse({ type: ArcProgressDto })
  @ApiNotFoundResponse({ description: 'No readable Arc matches the slug.' })
  async findProgress(
    @Param('arcSlug') arcSlug: string,
    @UserId() userId: string,
  ): Promise<ArcProgressDto> {
    await this.assertEnabled();

    const arc = await this._arcService.findPublicBySlug(arcSlug);

    if (!arc) {
      throw new NotFoundException('Arc not found');
    }

    const memberships = await this._membershipService.findApprovedByArc(arc.id);
    const stories = await this._storyService.findPublicByIds(
      memberships.map(membership => membership.storyId),
    );

    // Ordered by the Arc rather than by the lookup, so "continue" follows the
    // reading order the curator set rather than whatever the database returned.
    const byId = new Map(stories.map(story => [story.id, story]));
    const ordered = memberships
      .map(membership => byId.get(membership.storyId))
      .filter((story): story is StorytimeStoryEntity => story !== undefined);

    return this._progressService.summarise(userId, arc.id, ordered);
  }

  /**
   * Requires that public reading is switched on.
   */
  private async assertEnabled(): Promise<void> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );
  }
}
