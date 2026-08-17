import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { SpotlightDto } from './dto/spotlight.dto';
import { StorytimeSpotlightMapper } from './storytime-spotlight.mapper';
import { StorytimeSpotlightService } from './storytime-spotlight.service';

/**
 * Reading the Storytime Spotlight, without needing an account.
 *
 * Every route here answers with what is true now: entries whose featured work
 * has been unpublished, made private or removed are simply not among the
 * results, and no editorial action is needed to make that happen.
 */
@ApiTags('Storytime')
@Controller('storytime/spotlight')
export class PublicStorytimeSpotlightController {
  /**
   * Creates an instance of PublicStorytimeSpotlightController.
   *
   * @param _spotlightService - The Spotlight service.
   * @param _mapper - Maps entries to their response shapes.
   * @param _featureService - Reports whether the Spotlight is switched on.
   */
  constructor(
    private readonly _spotlightService: StorytimeSpotlightService,
    private readonly _mapper: StorytimeSpotlightMapper,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists what the Spotlight is showing now.
   *
   * @returns The showing entries, best first.
   */
  @Get()
  @ApiOperation({ summary: 'List the current Spotlight selections' })
  @ApiOkResponse({ type: [SpotlightDto] })
  async findShowing(): Promise<SpotlightDto[]> {
    await this.assertEnabled();

    return this._mapper.toPublicList(
      await this._spotlightService.findShowing(),
    );
  }

  /**
   * Lists the selections that have finished showing.
   *
   * @returns The past entries, most recent first.
   */
  @Get('archive')
  @ApiOperation({ summary: 'Browse past Spotlight selections' })
  @ApiOkResponse({ type: [SpotlightDto] })
  async findArchive(): Promise<SpotlightDto[]> {
    await this.assertEnabled();

    return this._mapper.toPublicList(
      await this._spotlightService.findArchive(),
    );
  }

  /**
   * Reads one Spotlight selection.
   *
   * Declared after `archive` so that word is never mistaken for a slug.
   *
   * @param spotlightSlug - The entry slug.
   * @returns The entry and the work it features.
   */
  @Get(':spotlightSlug')
  @ApiOperation({ summary: 'Read one Spotlight selection' })
  @ApiOkResponse({ type: SpotlightDto })
  @ApiNotFoundResponse({ description: 'No showing entry matches the slug.' })
  async findOne(
    @Param('spotlightSlug') spotlightSlug: string,
  ): Promise<SpotlightDto> {
    await this.assertEnabled();

    const resolved = await this._spotlightService.findBySlug(spotlightSlug);

    if (!resolved) {
      throw new NotFoundException('Spotlight entry not found');
    }

    return this._mapper.toPublic(resolved);
  }

  /**
   * Refuses when the Spotlight is switched off.
   *
   * Both switches apply: the Spotlight is a way of reading Storytime content,
   * so an environment with public reading off must not surface it, and an
   * environment that has switched the Spotlight off specifically must not
   * either.
   */
  private async assertEnabled(): Promise<void> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.SPOTLIGHT_ENABLED,
    );
  }
}
