import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSION_CODES } from 'src/access-control/constants/permission-codes.constants';
import { PermissionsGuard } from 'src/access-control/permissions.guard';
import { RequiresPermission } from 'src/access-control/requires-permission.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { OptionalUserId, UserId } from 'src/auth/user-id.decorator';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { ParseStorytimeTargetTypePipe } from '../shared/parse-storytime-target-type.pipe';
import { ReactDto, ReactionSummaryDto } from './dto/reaction.dto';
import { StorytimeReactionService } from './storytime-reaction.service';

/**
 * Reacting to Stories, Chapters and Arcs.
 *
 * Reading how something stands needs no account — the rating is on every card
 * already. Reacting does, because a reaction belongs to one person and has to
 * be changeable by that person and nobody else.
 */
@ApiTags('Storytime')
@Controller('storytime/reactions')
export class StorytimeReactionsController {
  /**
   * Creates an instance of StorytimeReactionsController.
   *
   * @param _reactionService - The reaction service.
   */
  constructor(private readonly _reactionService: StorytimeReactionService) {}

  /**
   * Reads how something stands.
   *
   * @param targetType - What kind of thing.
   * @param targetId - The thing.
   * @param userId - The reader, or null when nobody is signed in.
   * @returns The counts, and what that reader chose.
   */
  @Get(':targetType/:targetId')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Read the reactions on a piece of content' })
  @ApiOkResponse({ type: ReactionSummaryDto })
  async findOne(
    @Param('targetType', ParseStorytimeTargetTypePipe)
    targetType: StorytimeTargetType,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @OptionalUserId() userId: string | null,
  ): Promise<ReactionSummaryDto> {
    return this._reactionService.summarise(targetType, targetId, userId);
  }

  /**
   * Records what the caller thinks of something.
   *
   * @param dto - What they reacted to, and how.
   * @param userId - The reader.
   * @returns How it stands afterwards.
   */
  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(PERMISSION_CODES.STORYTIME_REACTION_CREATE)
  @ApiOperation({ summary: 'React to a Story, Chapter or Arc' })
  @ApiOkResponse({ type: ReactionSummaryDto })
  @ApiBadRequestResponse({ description: 'That cannot be reacted to.' })
  async react(
    @Body() dto: ReactDto,
    @UserId() userId: string,
  ): Promise<ReactionSummaryDto> {
    return this._reactionService.react(
      dto.targetType,
      dto.targetId,
      dto.reaction,
      userId,
    );
  }

  /**
   * Takes the caller's reaction back.
   *
   * @param targetType - What kind of thing.
   * @param targetId - The thing.
   * @param userId - The reader.
   * @returns How it stands afterwards.
   */
  @Delete(':targetType/:targetId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Take your reaction back' })
  @ApiOkResponse({ type: ReactionSummaryDto })
  async remove(
    @Param('targetType', ParseStorytimeTargetTypePipe)
    targetType: StorytimeTargetType,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @UserId() userId: string,
  ): Promise<ReactionSummaryDto> {
    return this._reactionService.remove(targetType, targetId, userId);
  }
}
