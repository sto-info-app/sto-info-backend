import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import {
  HeldMessagePageDto,
  ModerationHoldDetailDto,
  ModerationHoldDto,
  ModerationHoldExtendDto,
  ModerationHoldPlaceDto,
  ModerationHoldReadDto,
  ModerationHoldReleaseDto,
  ModerationHoldsQueryDto,
} from './moderation-hold.dto';
import { ModerationHoldService } from './moderation-hold.service';

/**
 * The site admins' holds on chat evidence (FC-036). Every route needs the
 * ADMIN role; none needs chat switched on, so a hold outlives the switch.
 */
@ApiTags('Moderation (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/moderation-holds')
export class ModerationHoldsController {
  /**
   * Creates an instance of ModerationHoldsController.
   *
   * @param _holds - Holds.
   */
  constructor(private readonly _holds: ModerationHoldService) {}

  /**
   * Lists holds, those due for review first.
   *
   * @param query - Whether only those in force, or released.
   * @returns Each.
   */
  @Get()
  @ApiOperation({ summary: 'List moderation holds (admin)' })
  @ApiOkResponse({ type: [ModerationHoldDto] })
  list(@Query() query: ModerationHoldsQueryDto): Promise<ModerationHoldDto[]> {
    return this._holds.list(query.active);
  }

  /**
   * Places a hold.
   *
   * @param userId - The site admin.
   * @param dto - What, why, and when to review it.
   * @returns The hold.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Place a moderation hold (admin)' })
  @ApiOkResponse({ type: ModerationHoldDetailDto })
  @ApiConflictResponse({ description: 'One is already in force.' })
  place(
    @UserId() userId: string,
    @Body() dto: ModerationHoldPlaceDto,
  ): Promise<ModerationHoldDetailDto> {
    return this._holds.place(userId, dto);
  }

  /**
   * Reads a hold and its log.
   *
   * @param holdId - The hold.
   * @returns It.
   */
  @Get(':holdId')
  @ApiOperation({ summary: 'Get a moderation hold (admin)' })
  @ApiOkResponse({ type: ModerationHoldDetailDto })
  @ApiNotFoundResponse({ description: 'No such hold.' })
  detail(
    @Param('holdId', ParseUUIDPipe) holdId: string,
  ): Promise<ModerationHoldDetailDto> {
    return this._holds.detail(holdId);
  }

  /**
   * Moves a hold's review date.
   *
   * @param holdId - The hold.
   * @param userId - The site admin.
   * @param dto - The new date, and why.
   * @returns The hold.
   */
  @Post(':holdId/extend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Extend a moderation hold (admin)' })
  @ApiOkResponse({ type: ModerationHoldDetailDto })
  extend(
    @Param('holdId', ParseUUIDPipe) holdId: string,
    @UserId() userId: string,
    @Body() dto: ModerationHoldExtendDto,
  ): Promise<ModerationHoldDetailDto> {
    return this._holds.extend(holdId, userId, dto);
  }

  /**
   * Releases a hold.
   *
   * @param holdId - The hold.
   * @param userId - The site admin.
   * @param dto - Why.
   * @returns The hold.
   */
  @Post(':holdId/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release a moderation hold (admin)' })
  @ApiOkResponse({ type: ModerationHoldDetailDto })
  release(
    @Param('holdId', ParseUUIDPipe) holdId: string,
    @UserId() userId: string,
    @Body() dto: ModerationHoldReleaseDto,
  ): Promise<ModerationHoldDetailDto> {
    return this._holds.release(holdId, userId, dto.reason);
  }

  /**
   * Reads what a hold keeps, with a purpose. Every reading is logged.
   *
   * @param holdId - The hold.
   * @param userId - The site admin.
   * @param dto - Why, and where to carry on from.
   * @returns A page, newest first.
   */
  @Post(':holdId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read what a moderation hold keeps (admin)' })
  @ApiOkResponse({ type: HeldMessagePageDto })
  read(
    @Param('holdId', ParseUUIDPipe) holdId: string,
    @UserId() userId: string,
    @Body() dto: ModerationHoldReadDto,
  ): Promise<HeldMessagePageDto> {
    return this._holds.read(holdId, userId, dto);
  }
}
