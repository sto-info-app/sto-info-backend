import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { ArcDto, ArcWithStoriesDto } from './dto/arc.dto';
import { StorytimeArcMembershipService } from './storytime-arc-membership.service';
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
   * @param _featureService - Reports whether public reading is switched on.
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
   * Lists the Arcs anybody may discover.
   *
   * @returns The public Arcs, newest first.
   */
  @Get()
  @ApiOperation({ summary: 'List published Arcs' })
  @ApiOkResponse({ type: [ArcDto] })
  async findAll(): Promise<ArcDto[]> {
    await this.assertEnabled();

    return this._mapper.toPublicList(await this._arcService.findPublic());
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
    const byId = new Map(
      stories.map(story => [story.id, this._storyMapper.toPublic(story)]),
    );

    return {
      arc: this._mapper.toPublic(arc),
      // Filtered to the Stories that are readable now. A membership naming a
      // Story that is not out yet is a real agreement, but showing it would
      // offer a reader a step they cannot take.
      stories: this._mapper
        .toMembershipList(memberships, byId)
        .filter(membership => membership.story !== null),
    };
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
