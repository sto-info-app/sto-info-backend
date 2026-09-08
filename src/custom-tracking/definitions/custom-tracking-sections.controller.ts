import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { CustomTrackingEditingGuard } from '../custom-tracking-editing.guard';
import { ReorderCustomTrackingDto } from '../dto/custom-tracking-reorder.dto';
import {
  CreateCustomTrackingSectionDto,
  CustomTrackingSectionDto,
  UpdateCustomTrackingSectionDto,
} from '../dto/custom-tracking-section.dto';
import { CustomTrackingSectionTreeDto } from '../dto/custom-tracking-tree.dto';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingDeletionImpact } from './custom-tracking-cascade.service';
import { CustomTrackingDefinitionTreeService } from './custom-tracking-definition-tree.service';
import { CustomTrackingDefinitionMapper } from './custom-tracking-definition.mapper';
import { CustomTrackingSectionService } from './custom-tracking-section.service';

/**
 * Sections, the outermost level of a user's own hierarchy.
 *
 * The target scope is in the path rather than the body. It is fixed for the
 * life of a Section, so it belongs to where the Section lives rather than to
 * what can be said about it, and a route that named it in the body would
 * suggest otherwise.
 *
 * Reading needs only an account. Everything that writes also passes the
 * editing guard, which requires the feature to be switched on and the content
 * agreement to have been accepted.
 */
@ApiTags('Custom Tracking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('custom-tracking')
export class CustomTrackingSectionsController {
  /**
   * Creates an instance of CustomTrackingSectionsController.
   *
   * @param _sections - Section behaviour.
   * @param _tree - Loads a whole scope's definitions at once.
   * @param _mapper - Maps Sections to their response shape.
   */
  constructor(
    private readonly _sections: CustomTrackingSectionService,
    private readonly _tree: CustomTrackingDefinitionTreeService,
    private readonly _mapper: CustomTrackingDefinitionMapper,
  ) {}

  /**
   * Reads a whole scope's definitions in one request.
   *
   * The builder needs all of it at once. It searches and filters across the
   * hierarchy, and a search that could only see the branches somebody had
   * already opened would quietly miss what it was asked for.
   *
   * @param userId - The caller.
   * @param targetScope - Which of their two hierarchies to read.
   * @returns The Sections, each with its Tabs and their Fields, in order.
   */
  @Get('scopes/:scope/definitions')
  @ApiOperation({ summary: 'Read the whole definition tree for one scope' })
  @ApiOkResponse({ type: [CustomTrackingSectionTreeDto] })
  async tree(
    @UserId() userId: string,
    @Param('scope', new ParseEnumPipe(CustomTrackingTargetScope))
    targetScope: CustomTrackingTargetScope,
  ): Promise<CustomTrackingSectionTreeDto[]> {
    const sections = await this._tree.load(userId, targetScope);

    return sections.map(section => this._mapper.toSectionTree(section));
  }

  /**
   * Lists the caller's Sections in one scope.
   *
   * @param userId - The caller.
   * @param targetScope - Which of their two hierarchies to list.
   * @returns The Sections, in order.
   */
  @Get('scopes/:scope/sections')
  @ApiOperation({ summary: 'List your sections for one target scope' })
  @ApiOkResponse({ type: [CustomTrackingSectionDto] })
  async list(
    @UserId() userId: string,
    @Param('scope', new ParseEnumPipe(CustomTrackingTargetScope))
    targetScope: CustomTrackingTargetScope,
  ): Promise<CustomTrackingSectionDto[]> {
    const sections = await this._sections.list(userId, targetScope);

    return sections.map(section => this._mapper.toSection(section));
  }

  /**
   * Creates a Section.
   *
   * @param userId - The caller.
   * @param targetScope - Which hierarchy to create it in.
   * @param body - What the user asked for.
   * @returns The new Section.
   */
  @Post('scopes/:scope/sections')
  @UseGuards(CustomTrackingEditingGuard)
  @ApiOperation({ summary: 'Create a section' })
  @ApiOkResponse({ type: CustomTrackingSectionDto })
  @ApiForbiddenResponse({ description: 'The content agreement is unaccepted.' })
  @ApiConflictResponse({
    description: 'The scope is full or the name is used.',
  })
  async create(
    @UserId() userId: string,
    @Param('scope', new ParseEnumPipe(CustomTrackingTargetScope))
    targetScope: CustomTrackingTargetScope,
    @Body() body: CreateCustomTrackingSectionDto,
  ): Promise<CustomTrackingSectionDto> {
    return this._mapper.toSection(
      await this._sections.create(userId, targetScope, {
        name: body.name,
        description: body.description,
        publiclyVisible: body.publiclyVisible,
      }),
    );
  }

  /**
   * Changes a Section's wording or visibility.
   *
   * @param userId - The caller.
   * @param sectionId - The Section to change.
   * @param body - What to change.
   * @returns The Section as it now stands.
   */
  @Patch('sections/:sectionId')
  @UseGuards(CustomTrackingEditingGuard)
  @ApiOperation({ summary: 'Change a section' })
  @ApiOkResponse({ type: CustomTrackingSectionDto })
  @ApiNotFoundResponse({ description: 'No such section of yours.' })
  @ApiConflictResponse({ description: 'The name is already used.' })
  async update(
    @UserId() userId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() body: UpdateCustomTrackingSectionDto,
  ): Promise<CustomTrackingSectionDto> {
    return this._mapper.toSection(
      await this._sections.update(userId, sectionId, body),
    );
  }

  /**
   * Reports what deleting a Section would take with it.
   *
   * Read before the confirmation is shown, because "delete this section" and
   * "delete this section, four tabs and nineteen fields" are different
   * decisions and only one of them is the one being made.
   *
   * @param userId - The caller.
   * @param sectionId - The Section being considered.
   * @returns How many Tabs and Fields would go with it.
   */
  @Get('sections/:sectionId/deletion-impact')
  @ApiOperation({ summary: 'See what deleting a section would remove' })
  @ApiOkResponse({ description: 'Counts of the descendants affected.' })
  @ApiNotFoundResponse({ description: 'No such section of yours.' })
  describeDeletion(
    @UserId() userId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<CustomTrackingDeletionImpact> {
    return this._sections.describeDeletion(userId, sectionId);
  }

  /**
   * Deletes a Section and everything beneath it.
   *
   * @param userId - The caller.
   * @param sectionId - The Section to delete.
   */
  @Delete('sections/:sectionId')
  @UseGuards(CustomTrackingEditingGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a section and everything in it' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiNotFoundResponse({ description: 'No such section of yours.' })
  async remove(
    @UserId() userId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<void> {
    await this._sections.remove(userId, sectionId);
  }

  /**
   * Puts the caller's Sections into a new order.
   *
   * @param userId - The caller.
   * @param targetScope - Which hierarchy is being ordered.
   * @param body - Every live Section in it, in order.
   */
  @Put('scopes/:scope/sections/order')
  @UseGuards(CustomTrackingEditingGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reorder your sections' })
  @ApiNoContentResponse({ description: 'Reordered.' })
  @ApiBadRequestResponse({
    description: 'The list is not exactly the sections in this scope.',
  })
  async reorder(
    @UserId() userId: string,
    @Param('scope', new ParseEnumPipe(CustomTrackingTargetScope))
    targetScope: CustomTrackingTargetScope,
    @Body() body: ReorderCustomTrackingDto,
  ): Promise<void> {
    await this._sections.reorder(userId, targetScope, body.orderedIds);
  }
}
