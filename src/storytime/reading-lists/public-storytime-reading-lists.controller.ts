import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { ReadingListDetailDto, ReadingListDto } from './dto/reading-list.dto';
import { StorytimeReadingListMapper } from './storytime-reading-list.mapper';
import { StorytimeReadingListService } from './storytime-reading-list.service';

/**
 * Reading lists a member has made public.
 *
 * Reached by member identifier and list address, matching the creator page:
 * a list belongs to somebody, and two people may name theirs the same thing.
 *
 * A private list is not found rather than forbidden here — that somebody keeps
 * a list at all is theirs to disclose.
 */
@ApiTags('Storytime')
@Controller('storytime/creators')
export class PublicStorytimeReadingListsController {
  /**
   * Creates an instance of PublicStorytimeReadingListsController.
   *
   * @param _service - Reading lists.
   * @param _mapper - Maps lists to their response shape.
   * @param _featureService - Reports whether public reading is switched on.
   */
  constructor(
    private readonly _service: StorytimeReadingListService,
    private readonly _mapper: StorytimeReadingListMapper,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the public lists a member keeps.
   *
   * @param userId - The member.
   * @returns Their public lists.
   */
  @Get(':userId/reading-lists')
  @ApiOperation({ summary: 'List a member’s public reading lists' })
  @ApiOkResponse({ type: [ReadingListDto] })
  async findByOwner(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<ReadingListDto[]> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    return this._mapper.toDtos(await this._service.findPublicByOwner(userId));
  }

  /**
   * Reads one public list.
   *
   * @param userId - Who keeps it.
   * @param slug - Its address.
   * @returns The list and what is on it.
   * @throws NotFoundException when there is no public list there.
   */
  @Get(':userId/reading-lists/:slug')
  @ApiOperation({ summary: 'Read a member’s public reading list' })
  @ApiOkResponse({ type: ReadingListDetailDto })
  @ApiNotFoundResponse({ description: 'There is no public list there.' })
  async findOne(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('slug') slug: string,
  ): Promise<ReadingListDetailDto> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    const list = await this._service.findPublicBySlug(userId, slug);

    if (!list) {
      throw new NotFoundException('There is no reading list at that address.');
    }

    return this._mapper.toDetailDto(
      list,
      await this._service.findEntries(list.id),
    );
  }
}
