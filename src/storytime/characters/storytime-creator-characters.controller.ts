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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSION_CODES } from 'src/access-control/constants/permission-codes.constants';
import { PermissionsGuard } from 'src/access-control/permissions.guard';
import { RequiresPermission } from 'src/access-control/requires-permission.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { ChapterAppearanceDto } from './dto/appearance.dto';
import { ManagedCharacterDto } from './dto/character.dto';
import { CreateStorytimeCharacterDto } from './dto/create-storytime-character.dto';
import { ReorderCharactersDto } from './dto/reorder-characters.dto';
import { SetAppearancesDto } from './dto/set-appearances.dto';
import { UpdateStorytimeCharacterDto } from './dto/update-storytime-character.dto';
import { StorytimeAppearanceService } from './storytime-appearance.service';
import { StorytimeCharacterMapper } from './storytime-character.mapper';
import { StorytimeCharacterService } from './storytime-character.service';

/**
 * A creator managing the cast of their own Stories.
 *
 * The permission guard decides whether this kind of user may reach these
 * routes; whether they may act on a particular Character is settled in the
 * service, which resolves the owning Story and checks it.
 */
@ApiTags('Storytime (creator)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequiresPermission(PERMISSION_CODES.STORYTIME_STORY_EDIT_OWN)
@Controller('storytime/manage')
export class StorytimeCreatorCharactersController {
  /**
   * Creates an instance of StorytimeCreatorCharactersController.
   *
   * @param _characterService - The Character service.
   * @param _appearanceService - Records who appears in which Chapter.
   * @param _mapper - Maps Characters to their response shapes.
   * @param _featureService - Reports whether creation is switched on.
   */
  constructor(
    private readonly _characterService: StorytimeCharacterService,
    private readonly _appearanceService: StorytimeAppearanceService,
    private readonly _mapper: StorytimeCharacterMapper,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Lists the cast of a Story the caller owns.
   *
   * @param storyId - The Story.
   * @param userId - The caller.
   * @returns The cast, in display order.
   */
  @Get('stories/:storyId/characters')
  @ApiOperation({ summary: 'List the cast of one of your Stories' })
  @ApiOkResponse({ type: [ManagedCharacterDto] })
  @ApiForbiddenResponse({ description: 'Not your Story.' })
  async findByStory(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @UserId() userId: string,
  ): Promise<ManagedCharacterDto[]> {
    await this.assertEnabled();

    return this._mapper.toManagedList(
      await this._characterService.findManagedByStory(storyId, userId),
    );
  }

  /**
   * Retrieves one Character for editing.
   *
   * @param characterId - The Character.
   * @param userId - The caller.
   * @returns The Character.
   */
  @Get('characters/:characterId')
  @ApiOperation({ summary: 'Retrieve one of your Characters' })
  @ApiOkResponse({ type: ManagedCharacterDto })
  @ApiNotFoundResponse({ description: 'Character not found.' })
  async findOne(
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @UserId() userId: string,
  ): Promise<ManagedCharacterDto> {
    await this.assertEnabled();

    return this._mapper.toManaged(
      await this._characterService.findEditableOrFail(characterId, userId),
    );
  }

  /**
   * Creates a Character in a Story the caller owns.
   *
   * @param storyId - The Story to add to.
   * @param dto - The Character to create.
   * @param userId - The caller.
   * @returns The created Character.
   */
  @Post('stories/:storyId/characters')
  @ApiOperation({ summary: 'Add a Character to one of your Stories' })
  @ApiOkResponse({ type: ManagedCharacterDto })
  @ApiForbiddenResponse({ description: 'Not your Story.' })
  async create(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: CreateStorytimeCharacterDto,
    @UserId() userId: string,
  ): Promise<ManagedCharacterDto> {
    await this.assertEnabled();

    return this._mapper.toManaged(
      await this._characterService.create(storyId, dto, userId),
    );
  }

  /**
   * Updates a Character.
   *
   * @param characterId - The Character.
   * @param dto - The changes, including the version last seen.
   * @param userId - The caller.
   * @returns The updated Character.
   */
  @Patch('characters/:characterId')
  @ApiOperation({ summary: 'Edit one of your Characters' })
  @ApiOkResponse({ type: ManagedCharacterDto })
  @ApiConflictResponse({ description: 'The Character has changed since.' })
  async update(
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @Body() dto: UpdateStorytimeCharacterDto,
    @UserId() userId: string,
  ): Promise<ManagedCharacterDto> {
    await this.assertEnabled();

    return this._mapper.toManaged(
      await this._characterService.update(characterId, dto, userId),
    );
  }

  /**
   * Reorders the cast of a Story.
   *
   * @param storyId - The Story.
   * @param dto - Every Character, in display order.
   * @param userId - The caller.
   * @returns The cast in its new order.
   */
  @Post('stories/:storyId/characters/reorder')
  @ApiOperation({ summary: 'Reorder the cast of one of your Stories' })
  @ApiOkResponse({ type: [ManagedCharacterDto] })
  @ApiBadRequestResponse({
    description: 'The order did not list every Character exactly once.',
  })
  async reorder(
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: ReorderCharactersDto,
    @UserId() userId: string,
  ): Promise<ManagedCharacterDto[]> {
    await this.assertEnabled();

    return this._mapper.toManagedList(
      await this._characterService.reorder(storyId, dto.characterIds, userId),
    );
  }

  /**
   * Sets who appears in a Chapter.
   *
   * @param chapterId - The Chapter.
   * @param dto - The Characters appearing, in order.
   * @param userId - The caller.
   * @returns The Chapter's cast as saved.
   */
  @Post('chapters/:chapterId/characters')
  @ApiOperation({ summary: 'Set who appears in one of your Chapters' })
  @ApiOkResponse({ type: [ChapterAppearanceDto] })
  @ApiBadRequestResponse({
    description: 'A Character does not belong to the Chapter’s Story.',
  })
  async setAppearances(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: SetAppearancesDto,
    @UserId() userId: string,
  ): Promise<ChapterAppearanceDto[]> {
    await this.assertEnabled();

    const appearances = await this._appearanceService.setAppearances(
      chapterId,
      dto,
      userId,
    );

    return this._mapper.toAppearanceList(
      appearances,
      await this._characterService.findByIds(
        appearances.map(appearance => appearance.characterId),
      ),
    );
  }

  /**
   * Lists who appears in a Chapter the caller owns.
   *
   * @param chapterId - The Chapter.
   * @param userId - The caller.
   * @returns The Chapter's cast, in order.
   */
  @Get('chapters/:chapterId/characters')
  @ApiOperation({ summary: 'List who appears in one of your Chapters' })
  @ApiOkResponse({ type: [ChapterAppearanceDto] })
  @ApiForbiddenResponse({ description: 'Not your Story.' })
  async findAppearances(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @UserId() userId: string,
  ): Promise<ChapterAppearanceDto[]> {
    await this.assertEnabled();

    const appearances = await this._appearanceService.findByChapterForOwner(
      chapterId,
      userId,
    );

    return this._mapper.toAppearanceList(
      appearances,
      await this._characterService.findByIds(
        appearances.map(appearance => appearance.characterId),
      ),
    );
  }

  /**
   * Deletes a Character.
   *
   * @param characterId - The Character.
   * @param userId - The caller.
   */
  @Delete('characters/:characterId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of your Characters' })
  @ApiNoContentResponse({ description: 'The Character was deleted.' })
  async remove(
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this.assertEnabled();

    await this._characterService.remove(characterId, userId);
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
