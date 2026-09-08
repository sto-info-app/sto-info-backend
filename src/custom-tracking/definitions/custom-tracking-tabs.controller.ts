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
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
  CreateCustomTrackingTabDto,
  CustomTrackingTabDto,
  UpdateCustomTrackingTabDto,
} from '../dto/custom-tracking-tab.dto';
import { CustomTrackingDeletionImpact } from './custom-tracking-cascade.service';
import { CustomTrackingDefinitionMapper } from './custom-tracking-definition.mapper';
import { CustomTrackingTabService } from './custom-tracking-tab.service';

/**
 * Tabs, the grouping between a Section and its Fields.
 *
 * A Tab is addressed by its own identifier once created, but is only ever
 * created inside a Section, because it cannot be moved between them.
 */
@ApiTags('Custom Tracking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('custom-tracking')
export class CustomTrackingTabsController {
  /**
   * Creates an instance of CustomTrackingTabsController.
   *
   * @param _tabs - Tab behaviour.
   * @param _mapper - Maps Tabs to their response shape.
   */
  constructor(
    private readonly _tabs: CustomTrackingTabService,
    private readonly _mapper: CustomTrackingDefinitionMapper,
  ) {}

  /**
   * Lists a Section's Tabs.
   *
   * @param userId - The caller.
   * @param sectionId - The Section whose Tabs are wanted.
   * @returns The Tabs, in order.
   */
  @Get('sections/:sectionId/tabs')
  @ApiOperation({ summary: 'List a section’s tabs' })
  @ApiOkResponse({ type: [CustomTrackingTabDto] })
  @ApiNotFoundResponse({ description: 'No such section of yours.' })
  async list(
    @UserId() userId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<CustomTrackingTabDto[]> {
    const tabs = await this._tabs.list(userId, sectionId);

    return tabs.map(tab => this._mapper.toTab(tab));
  }

  /**
   * Creates a Tab in a Section.
   *
   * @param userId - The caller.
   * @param sectionId - The Section to create it in.
   * @param body - What the user asked for.
   * @returns The new Tab.
   */
  @Post('sections/:sectionId/tabs')
  @UseGuards(CustomTrackingEditingGuard)
  @ApiOperation({ summary: 'Create a tab' })
  @ApiOkResponse({ type: CustomTrackingTabDto })
  @ApiConflictResponse({
    description: 'The section is full or the name is used.',
  })
  async create(
    @UserId() userId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() body: CreateCustomTrackingTabDto,
  ): Promise<CustomTrackingTabDto> {
    return this._mapper.toTab(
      await this._tabs.create(userId, sectionId, {
        name: body.name,
        description: body.description,
        publiclyVisible: body.publiclyVisible,
      }),
    );
  }

  /**
   * Changes a Tab's wording or visibility.
   *
   * @param userId - The caller.
   * @param tabId - The Tab to change.
   * @param body - What to change.
   * @returns The Tab as it now stands.
   */
  @Patch('tabs/:tabId')
  @UseGuards(CustomTrackingEditingGuard)
  @ApiOperation({ summary: 'Change a tab' })
  @ApiOkResponse({ type: CustomTrackingTabDto })
  @ApiNotFoundResponse({ description: 'No such tab of yours.' })
  @ApiConflictResponse({ description: 'The name is already used.' })
  async update(
    @UserId() userId: string,
    @Param('tabId', ParseUUIDPipe) tabId: string,
    @Body() body: UpdateCustomTrackingTabDto,
  ): Promise<CustomTrackingTabDto> {
    return this._mapper.toTab(await this._tabs.update(userId, tabId, body));
  }

  /**
   * Reports what deleting a Tab would take with it.
   *
   * @param userId - The caller.
   * @param tabId - The Tab being considered.
   * @returns How many Fields would go with it.
   */
  @Get('tabs/:tabId/deletion-impact')
  @ApiOperation({ summary: 'See what deleting a tab would remove' })
  @ApiOkResponse({ description: 'Counts of the descendants affected.' })
  @ApiNotFoundResponse({ description: 'No such tab of yours.' })
  describeDeletion(
    @UserId() userId: string,
    @Param('tabId', ParseUUIDPipe) tabId: string,
  ): Promise<CustomTrackingDeletionImpact> {
    return this._tabs.describeDeletion(userId, tabId);
  }

  /**
   * Deletes a Tab and the Fields beneath it.
   *
   * @param userId - The caller.
   * @param tabId - The Tab to delete.
   */
  @Delete('tabs/:tabId')
  @UseGuards(CustomTrackingEditingGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a tab and the fields in it' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiNotFoundResponse({ description: 'No such tab of yours.' })
  async remove(
    @UserId() userId: string,
    @Param('tabId', ParseUUIDPipe) tabId: string,
  ): Promise<void> {
    await this._tabs.remove(userId, tabId);
  }

  /**
   * Puts a Section's Tabs into a new order.
   *
   * @param userId - The caller.
   * @param sectionId - The Section being ordered.
   * @param body - Every live Tab in it, in order.
   */
  @Put('sections/:sectionId/tabs/order')
  @UseGuards(CustomTrackingEditingGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reorder a section’s tabs' })
  @ApiNoContentResponse({ description: 'Reordered.' })
  @ApiBadRequestResponse({
    description: 'The list is not exactly the tabs in this section.',
  })
  async reorder(
    @UserId() userId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() body: ReorderCustomTrackingDto,
  ): Promise<void> {
    await this._tabs.reorder(userId, sectionId, body.orderedIds);
  }
}
