import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
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

import { CustomTrackingDefinitionTreeService } from '../definitions/custom-tracking-definition-tree.service';
import { CustomTrackingDefinitionMapper } from '../definitions/custom-tracking-definition.mapper';
import { CustomTrackingSuppressionDto } from '../dto/custom-tracking-moderation.dto';
import { CustomTrackingSectionTreeDto } from '../dto/custom-tracking-tree.dto';
import { CustomTrackingModerationLevel } from '../enums/custom-tracking-moderation-level.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingModerationService } from './custom-tracking-moderation.service';

/**
 * What an administrator can do about somebody's custom content.
 *
 * Mounted under the existing admin moderation path rather than beside the
 * member's own Custom Tracking routes. An administrator looking for what they
 * are allowed to do to another member's account should find all of it in one
 * place, and a suppression route sitting among the routes a member uses on
 * their own data is a role check away from being a very bad afternoon.
 *
 * The reading route exists because you cannot suppress what you cannot
 * address. It returns the member's headings, tabs and field names for one
 * scope — the same tree they see in their own settings, and no answers. What
 * was actually written is on the page the report came from.
 */
@ApiTags('Moderation (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/moderation/custom-tracking')
export class CustomTrackingModerationController {
  /**
   * Creates an instance of CustomTrackingModerationController.
   *
   * @param _moderation - Suppresses and restores.
   * @param _tree - Loads a member's definitions.
   * @param _mapper - Maps them to their response shape.
   */
  constructor(
    private readonly _moderation: CustomTrackingModerationService,
    private readonly _tree: CustomTrackingDefinitionTreeService,
    private readonly _mapper: CustomTrackingDefinitionMapper,
  ) {}

  /**
   * Lists what a member has defined, so an administrator can name the part
   * that offends.
   *
   * @param scope - Whether their Account or their Character hierarchy is
   *   wanted.
   * @param ownerUserId - The member.
   * @returns Their Sections, Tabs and Fields, in order.
   */
  @Get(':scope/:ownerUserId')
  @ApiOperation({ summary: "List a member's custom definitions (admin)" })
  @ApiOkResponse({
    description: 'Their Sections, Tabs and Fields.',
    type: [CustomTrackingSectionTreeDto],
  })
  @ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
  async findTree(
    @Param('scope', new ParseEnumPipe(CustomTrackingTargetScope))
    scope: CustomTrackingTargetScope,
    @Param('ownerUserId', ParseUUIDPipe) ownerUserId: string,
  ): Promise<CustomTrackingSectionTreeDto[]> {
    const sections = await this._tree.load(ownerUserId, scope);

    return sections.map(section => this._mapper.toSectionTree(section));
  }

  /**
   * Hides one Section, Tab or Field from everybody but its owner.
   *
   * @param adminUserId - The acting administrator's user ID.
   * @param level - Which level is being acted on.
   * @param id - The row.
   * @returns Its state afterwards.
   */
  @Post(':level/:id/suppress')
  @ApiOperation({ summary: 'Hide custom content from public view (admin)' })
  @ApiOkResponse({
    description: 'What was suppressed.',
    type: CustomTrackingSuppressionDto,
  })
  @ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
  @ApiNotFoundResponse({ description: 'No such live section, tab or field.' })
  suppress(
    @UserId() adminUserId: string,
    @Param('level', new ParseEnumPipe(CustomTrackingModerationLevel))
    level: CustomTrackingModerationLevel,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomTrackingSuppressionDto> {
    return this._moderation.suppress(level, id, adminUserId);
  }

  /**
   * Puts suppressed content back into public view.
   *
   * @param adminUserId - The acting administrator's user ID.
   * @param level - Which level is being acted on.
   * @param id - The row.
   * @returns Its state afterwards.
   */
  @Post(':level/:id/restore')
  @ApiOperation({ summary: 'Restore suppressed custom content (admin)' })
  @ApiOkResponse({
    description: 'What was restored.',
    type: CustomTrackingSuppressionDto,
  })
  @ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
  @ApiNotFoundResponse({ description: 'No such live section, tab or field.' })
  restore(
    @UserId() adminUserId: string,
    @Param('level', new ParseEnumPipe(CustomTrackingModerationLevel))
    level: CustomTrackingModerationLevel,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomTrackingSuppressionDto> {
    return this._moderation.restore(level, id, adminUserId);
  }
}
