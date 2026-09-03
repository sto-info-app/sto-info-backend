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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import {
  AddReadingListItemDto,
  CreateReadingListDto,
  ReadingListDetailDto,
  ReadingListDto,
  ReorderReadingListDto,
  UpdateReadingListDto,
} from './dto/reading-list.dto';
import { StorytimeReadingListMapper } from './storytime-reading-list.mapper';
import { StorytimeReadingListService } from './storytime-reading-list.service';

/**
 * A member's own reading lists.
 *
 * Everything here needs sign-in and acts on the caller's own lists. Public
 * lists are read through the public controller instead, so that no route has to
 * decide between "yours" and "anybody's" halfway through.
 */
@ApiTags('Storytime')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storytime/reading-lists')
export class StorytimeReadingListsController {
  /**
   * Creates an instance of StorytimeReadingListsController.
   *
   * @param _service - Reading lists.
   * @param _mapper - Maps lists to their response shape.
   */
  constructor(
    private readonly _service: StorytimeReadingListService,
    private readonly _mapper: StorytimeReadingListMapper,
  ) {}

  /**
   * Lists the caller's own lists.
   *
   * @param userId - The member.
   * @returns Their lists, private ones included.
   */
  @Get()
  @ApiOperation({ summary: 'List your reading lists' })
  @ApiOkResponse({ type: [ReadingListDto] })
  async findMine(@UserId() userId: string): Promise<ReadingListDto[]> {
    return this._mapper.toDtos(await this._service.findMine(userId));
  }

  /**
   * Reports which of the caller's lists already hold something.
   *
   * @param targetType - Whether it is a Story or an Arc.
   * @param targetId - The thing.
   * @param userId - The member.
   * @returns The identifiers of their lists holding it.
   */
  @Get('holding')
  @ApiOperation({ summary: 'Find which of your lists hold something' })
  @ApiOkResponse({ type: [String] })
  async findHolding(
    @Query('targetType') targetType: StorytimeTargetType,
    @Query('targetId', ParseUUIDPipe) targetId: string,
    @UserId() userId: string,
  ): Promise<string[]> {
    return this._service.findListsHolding(targetType, targetId, userId);
  }

  /**
   * Makes a list.
   *
   * @param dto - What it is called, and whether anybody may read it.
   * @param userId - Who keeps it.
   * @returns The list.
   */
  @Post()
  @ApiOperation({ summary: 'Make a reading list' })
  @ApiOkResponse({ type: ReadingListDto })
  @ApiBadRequestResponse({ description: 'The list needs a name.' })
  async create(
    @Body() dto: CreateReadingListDto,
    @UserId() userId: string,
  ): Promise<ReadingListDto> {
    return this._mapper.toDto(await this._service.create(dto, userId));
  }

  /**
   * Reads one of the caller's lists, and what is on it.
   *
   * @param listId - The list.
   * @param userId - Who is asking.
   * @returns The list with its items.
   */
  @Get(':listId')
  @ApiOperation({ summary: 'Read one of your reading lists' })
  @ApiOkResponse({ type: ReadingListDetailDto })
  @ApiNotFoundResponse({ description: 'There is no such list.' })
  @ApiForbiddenResponse({ description: 'That list is not yours.' })
  async findOne(
    @Param('listId', ParseUUIDPipe) listId: string,
    @UserId() userId: string,
  ): Promise<ReadingListDetailDto> {
    const list = await this._service.findOwned(listId, userId);

    return this._mapper.toDetailDto(
      list,
      await this._service.findEntries(list.id),
    );
  }

  /**
   * Changes a list.
   *
   * @param listId - The list.
   * @param dto - What to change.
   * @param userId - Who is asking.
   * @returns The list as it now stands.
   */
  @Patch(':listId')
  @ApiOperation({ summary: 'Change a reading list' })
  @ApiOkResponse({ type: ReadingListDto })
  async update(
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: UpdateReadingListDto,
    @UserId() userId: string,
  ): Promise<ReadingListDto> {
    return this._mapper.toDto(await this._service.update(listId, dto, userId));
  }

  /**
   * Deletes a list.
   *
   * @param listId - The list.
   * @param userId - Who is asking.
   */
  @Delete(':listId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a reading list' })
  @ApiNoContentResponse({ description: 'The list was deleted.' })
  async remove(
    @Param('listId', ParseUUIDPipe) listId: string,
    @UserId() userId: string,
  ): Promise<void> {
    await this._service.remove(listId, userId);
  }

  /**
   * Puts something on a list.
   *
   * @param listId - The list.
   * @param dto - What to add, and why.
   * @param userId - Who is asking.
   * @returns The list with its items.
   */
  @Post(':listId/items')
  @ApiOperation({ summary: 'Put something on a reading list' })
  @ApiOkResponse({ type: ReadingListDetailDto })
  @ApiBadRequestResponse({
    description: 'That is not something anybody can read.',
  })
  async addItem(
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: AddReadingListItemDto,
    @UserId() userId: string,
  ): Promise<ReadingListDetailDto> {
    await this._service.addItem(
      listId,
      dto.targetType,
      dto.targetId,
      dto.note ?? null,
      userId,
    );

    return this.findOne(listId, userId);
  }

  /**
   * Takes something off a list.
   *
   * @param listId - The list.
   * @param itemId - The item.
   * @param userId - Who is asking.
   * @returns The list with what remains.
   */
  @Delete(':listId/items/:itemId')
  @ApiOperation({ summary: 'Take something off a reading list' })
  @ApiOkResponse({ type: ReadingListDetailDto })
  @ApiNotFoundResponse({ description: 'That is not on this list.' })
  async removeItem(
    @Param('listId', ParseUUIDPipe) listId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @UserId() userId: string,
  ): Promise<ReadingListDetailDto> {
    await this._service.removeItem(listId, itemId, userId);

    return this.findOne(listId, userId);
  }

  /**
   * Puts a list in order.
   *
   * @param listId - The list.
   * @param dto - Every item, in the order wanted.
   * @param userId - Who is asking.
   * @returns The list in its new order.
   */
  @Patch(':listId/order')
  @ApiOperation({ summary: 'Put a reading list in order' })
  @ApiOkResponse({ type: ReadingListDetailDto })
  @ApiBadRequestResponse({
    description: 'The order must name every item exactly once.',
  })
  async reorder(
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: ReorderReadingListDto,
    @UserId() userId: string,
  ): Promise<ReadingListDetailDto> {
    await this._service.reorder(listId, dto.itemIds, userId);

    return this.findOne(listId, userId);
  }
}
