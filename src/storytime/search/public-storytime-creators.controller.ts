import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StorytimeArcMapper } from '../arcs/storytime-arc.mapper';
import { StorytimeArcService } from '../arcs/storytime-arc.service';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeTagMapper } from '../tags/storytime-tag.mapper';
import { StorytimeTaggingService } from '../tags/storytime-tagging.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { CreatorWorkDto } from './dto/creator-work.dto';

/**
 * A creator's published Storytime work.
 *
 * Reached by member identifier rather than by a slug of their own: a creator
 * page is a view of somebody's account, and the account already has an
 * address. This is the Storytime section of it, and nothing more.
 *
 * Only publicly listed work appears. Unlisted work stays reachable by link and
 * invisible to browsing, which is the promise its author relied on.
 */
@ApiTags('Storytime')
@Controller('storytime/creators')
export class PublicStorytimeCreatorsController {
  /**
   * Creates an instance of PublicStorytimeCreatorsController.
   *
   * @param _storyService - Resolves the member's Stories.
   * @param _arcService - Resolves the member's Arcs.
   * @param _storyMapper - Maps Stories to their reader-facing shape.
   * @param _arcMapper - Maps Arcs to their reader-facing shape.
   * @param _taggingService - Reads what their work is tagged with.
   * @param _tagMapper - Maps those tags to their response shape.
   * @param _featureService - Reports whether public reading is switched on.
   */
  constructor(
    private readonly _storyService: StorytimeStoryService,
    private readonly _arcService: StorytimeArcService,
    private readonly _storyMapper: StorytimeStoryMapper,
    private readonly _arcMapper: StorytimeArcMapper,
    private readonly _taggingService: StorytimeTaggingService,
    private readonly _tagMapper: StorytimeTagMapper,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists what a member has published.
   *
   * @param userId - The member.
   * @returns Their published Stories and Arcs.
   */
  @Get(':userId')
  @ApiOperation({ summary: 'List a member’s published Storytime work' })
  @ApiOkResponse({ type: CreatorWorkDto })
  async findByCreator(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<CreatorWorkDto> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    const stories = await this._storyService.findPublicPaginated({
      ownerUserId: userId,
    });
    const arcs = await this._arcService.findPublicByOwner(userId);

    return {
      stories: this._storyMapper.toPublicList(
        stories.items,
        this._tagMapper.toListsByTarget(
          await this._taggingService.findForMany(
            StorytimeTargetType.STORY,
            stories.items.map(story => story.id),
          ),
        ),
      ),
      arcs: this._arcMapper.toPublicList(
        arcs,
        this._tagMapper.toListsByTarget(
          await this._taggingService.findForMany(
            StorytimeTargetType.ARC,
            arcs.map(arc => arc.id),
          ),
        ),
      ),
    };
  }
}
