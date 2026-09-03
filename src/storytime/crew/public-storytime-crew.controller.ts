import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { CrewCreditDto, CrewRoleDto } from './dto/crew-credit.dto';
import { StorytimeCrewRoleEntity } from './entities/storytime-crew-role.entity';
import { StorytimeCrewCreditService } from './storytime-crew-credit.service';
import { StorytimeCrewMapper } from './storytime-crew.mapper';

/**
 * Reading a Story's credits, and the roles credits may be given in.
 *
 * The roles are public because the client needs them to render a credits roll
 * and to offer them when adding one; they are a taxonomy, not a secret.
 */
@ApiTags('Storytime')
@Controller('storytime')
export class PublicStorytimeCrewController {
  /**
   * Creates an instance of PublicStorytimeCrewController.
   *
   * @param _roleRepository - Repository of Crew roles.
   * @param _creditService - Crew credits.
   * @param _storyService - Resolves and gates the owning Story.
   * @param _mapper - Maps credits to their response shapes.
   * @param _featureService - Reports whether public reading is switched on.
   */
  constructor(
    @InjectRepository(StorytimeCrewRoleEntity)
    private readonly _roleRepository: Repository<StorytimeCrewRoleEntity>,
    private readonly _creditService: StorytimeCrewCreditService,
    private readonly _storyService: StorytimeStoryService,
    private readonly _mapper: StorytimeCrewMapper,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the roles a credit may be given in.
   *
   * @returns The roles, in credits-roll order.
   */
  @Get('crew-roles')
  @ApiOperation({ summary: 'List the roles a credit may be given in' })
  @ApiOkResponse({ type: [CrewRoleDto] })
  async findRoles(): Promise<CrewRoleDto[]> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    return this._mapper.toRoleList(
      await this._roleRepository.find({ order: { displayOrder: 'ASC' } }),
    );
  }

  /**
   * Lists a published Story's credits.
   *
   * @param storySlug - The Story slug.
   * @returns The credits, in credits-roll order.
   */
  @Get('stories/:storySlug/credits')
  @ApiOperation({ summary: 'Read a published Story’s credits' })
  @ApiOkResponse({ type: [CrewCreditDto] })
  @ApiNotFoundResponse({ description: 'No readable Story matches the slug.' })
  async findCredits(
    @Param('storySlug') storySlug: string,
  ): Promise<CrewCreditDto[]> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    const story = await this._storyService.findPublicBySlug(storySlug);

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    const credits = await this._creditService.findByStory(story.id);

    return this._mapper.toCreditList(
      credits,
      await this._creditService.findRolesByIds(
        credits.map(credit => credit.roleId),
      ),
    );
  }
}
