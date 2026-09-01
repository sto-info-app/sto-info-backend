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
import {
  CreateSpotlightDto,
  UpdateSpotlightDto,
} from './dto/create-spotlight.dto';
import { ManagedSpotlightDto } from './dto/spotlight.dto';
import { StorytimeSpotlightMapper } from './storytime-spotlight.mapper';
import { StorytimeSpotlightService } from './storytime-spotlight.service';

/**
 * Editorial control of the Storytime Spotlight.
 *
 * Gated by the Spotlight permission rather than by ownership. Choosing what
 * the site features is an editorial act on somebody else's work by definition,
 * which is exactly why it is a permission somebody has to be given.
 *
 * Not gated by the Spotlight feature flag: an editor must still be able to
 * prepare and correct selections in an environment where the Spotlight is not
 * being shown yet.
 */
@ApiTags('Storytime (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/storytime/spotlight')
export class AdminStorytimeSpotlightController {
  /**
   * Creates an instance of AdminStorytimeSpotlightController.
   *
   * @param _spotlightService - The Spotlight service.
   * @param _mapper - Maps entries to their response shapes.
   */
  constructor(
    private readonly _spotlightService: StorytimeSpotlightService,
    private readonly _mapper: StorytimeSpotlightMapper,
  ) {}

  /**
   * Lists every Spotlight entry, showing or not.
   *
   * @returns The entries with the work each features, most recently scheduled
   * first.
   */
  @Get()
  @RequiresPermission(PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE)
  @ApiOperation({ summary: 'List every Spotlight entry' })
  @ApiOkResponse({ type: [ManagedSpotlightDto] })
  @ApiForbiddenResponse({ description: 'Caller may not manage the Spotlight.' })
  async findAll(): Promise<ManagedSpotlightDto[]> {
    return this._mapper.toManagedList(await this._spotlightService.findAll());
  }

  /**
   * Retrieves one entry for editing.
   *
   * @param spotlightId - The entry.
   * @returns The entry.
   */
  @Get(':spotlightId')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE)
  @ApiOperation({ summary: 'Read one Spotlight entry' })
  @ApiOkResponse({ type: ManagedSpotlightDto })
  @ApiNotFoundResponse({ description: 'No entry has that identifier.' })
  async findOne(
    @Param('spotlightId', ParseUUIDPipe) spotlightId: string,
  ): Promise<ManagedSpotlightDto> {
    const resolved =
      await this._spotlightService.findOneWithWorkOrFail(spotlightId);

    return this._mapper.toManaged(resolved.entry, resolved);
  }

  /**
   * Drafts a Spotlight entry.
   *
   * @param dto - The entry to create.
   * @param actingUserId - The editor.
   * @returns The created entry.
   */
  @Post()
  @RequiresPermission(PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE)
  @ApiOperation({ summary: 'Draft a Spotlight entry' })
  @ApiOkResponse({ type: ManagedSpotlightDto })
  @ApiBadRequestResponse({ description: 'The work cannot be featured.' })
  async create(
    @Body() dto: CreateSpotlightDto,
    @UserId() actingUserId: string,
  ): Promise<ManagedSpotlightDto> {
    return this._mapper.toManaged(
      await this._spotlightService.create(dto, actingUserId),
    );
  }

  /**
   * Changes a Spotlight entry.
   *
   * @param spotlightId - The entry.
   * @param dto - The changes.
   * @param actingUserId - The editor.
   * @returns The entry after the change.
   */
  @Patch(':spotlightId')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE)
  @ApiOperation({ summary: 'Change a Spotlight entry' })
  @ApiOkResponse({ type: ManagedSpotlightDto })
  @ApiBadRequestResponse({ description: 'The change was refused.' })
  @ApiNotFoundResponse({ description: 'No entry has that identifier.' })
  async update(
    @Param('spotlightId', ParseUUIDPipe) spotlightId: string,
    @Body() dto: UpdateSpotlightDto,
    @UserId() actingUserId: string,
  ): Promise<ManagedSpotlightDto> {
    return this._mapper.toManaged(
      await this._spotlightService.update(spotlightId, dto, actingUserId),
    );
  }

  /**
   * Publishes a Spotlight entry, so it may show when its time comes.
   *
   * @param spotlightId - The entry.
   * @param actingUserId - The editor.
   * @returns The published entry.
   */
  @Post(':spotlightId/publish')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE)
  @ApiOperation({ summary: 'Publish a Spotlight entry' })
  @ApiOkResponse({ type: ManagedSpotlightDto })
  @ApiBadRequestResponse({ description: 'The work can no longer be featured.' })
  async publish(
    @Param('spotlightId', ParseUUIDPipe) spotlightId: string,
    @UserId() actingUserId: string,
  ): Promise<ManagedSpotlightDto> {
    return this._mapper.toManaged(
      await this._spotlightService.publish(spotlightId, actingUserId),
    );
  }

  /**
   * Withdraws a Spotlight entry from showing.
   *
   * @param spotlightId - The entry.
   * @param actingUserId - The editor.
   * @returns The withdrawn entry.
   */
  @Post(':spotlightId/unpublish')
  @RequiresPermission(PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE)
  @ApiOperation({ summary: 'Withdraw a Spotlight entry' })
  @ApiOkResponse({ type: ManagedSpotlightDto })
  @ApiNotFoundResponse({ description: 'No entry has that identifier.' })
  async unpublish(
    @Param('spotlightId', ParseUUIDPipe) spotlightId: string,
    @UserId() actingUserId: string,
  ): Promise<ManagedSpotlightDto> {
    return this._mapper.toManaged(
      await this._spotlightService.unpublish(spotlightId, actingUserId),
    );
  }

  /**
   * Deletes a Spotlight entry.
   *
   * @param spotlightId - The entry.
   * @param actingUserId - The editor.
   */
  @Delete(':spotlightId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresPermission(PERMISSION_CODES.STORYTIME_SPOTLIGHT_MANAGE)
  @ApiOperation({ summary: 'Delete a Spotlight entry' })
  @ApiNoContentResponse({ description: 'The entry was deleted.' })
  @ApiNotFoundResponse({ description: 'No entry has that identifier.' })
  async remove(
    @Param('spotlightId', ParseUUIDPipe) spotlightId: string,
    @UserId() actingUserId: string,
  ): Promise<void> {
    await this._spotlightService.remove(spotlightId, actingUserId);
  }
}
