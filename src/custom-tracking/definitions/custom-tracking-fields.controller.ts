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
import {
  CreateCustomTrackingFieldDto,
  CustomTrackingFieldDto,
  UpdateCustomTrackingFieldDto,
} from '../dto/custom-tracking-field.dto';
import { ReorderCustomTrackingDto } from '../dto/custom-tracking-reorder.dto';
import { CustomTrackingDeletionImpact } from './custom-tracking-cascade.service';
import { CustomTrackingDefinitionMapper } from './custom-tracking-definition.mapper';
import { CustomTrackingFieldService } from './custom-tracking-field.service';
import { CustomTrackingOptionService } from './custom-tracking-option.service';

/**
 * Fields, the questions a user asks of each of their Accounts or Characters.
 *
 * A Field's type is set at creation and never appears on an update. A request
 * naming one there is refused by the validation pipe rather than ignored, so a
 * user who believed they were changing it finds out that they were not.
 */
@ApiTags('Custom Tracking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('custom-tracking')
export class CustomTrackingFieldsController {
  /**
   * Creates an instance of CustomTrackingFieldsController.
   *
   * @param _fields - Field behaviour.
   * @param _options - The answers a choice Field offers.
   * @param _mapper - Maps Fields to their response shape.
   */
  constructor(
    private readonly _fields: CustomTrackingFieldService,
    private readonly _options: CustomTrackingOptionService,
    private readonly _mapper: CustomTrackingDefinitionMapper,
  ) {}

  /**
   * Lists a Tab's Fields, each with the options it offers.
   *
   * @param userId - The caller.
   * @param tabId - The Tab whose Fields are wanted.
   * @returns The Fields, in order.
   */
  @Get('tabs/:tabId/fields')
  @ApiOperation({ summary: 'List the fields in a tab' })
  @ApiOkResponse({ type: [CustomTrackingFieldDto] })
  @ApiNotFoundResponse({ description: 'No such tab of yours.' })
  async list(
    @UserId() userId: string,
    @Param('tabId', ParseUUIDPipe) tabId: string,
  ): Promise<CustomTrackingFieldDto[]> {
    const fields = await this._fields.list(userId, tabId);

    return Promise.all(
      fields.map(async field =>
        this._mapper.toField(field, await this._options.list(userId, field.id)),
      ),
    );
  }

  /**
   * Creates a Field in a Tab.
   *
   * @param userId - The caller.
   * @param tabId - The Tab to create it in.
   * @param body - What the user asked for.
   * @returns The new Field.
   */
  @Post('tabs/:tabId/fields')
  @UseGuards(CustomTrackingEditingGuard)
  @ApiOperation({ summary: 'Create a field' })
  @ApiOkResponse({ type: CustomTrackingFieldDto })
  @ApiBadRequestResponse({
    description: 'The settings do not describe a usable field of that type.',
  })
  @ApiConflictResponse({
    description: 'A limit is reached or the name is used.',
  })
  async create(
    @UserId() userId: string,
    @Param('tabId', ParseUUIDPipe) tabId: string,
    @Body() body: CreateCustomTrackingFieldDto,
  ): Promise<CustomTrackingFieldDto> {
    return this._mapper.toField(
      await this._fields.create(userId, tabId, {
        fieldType: body.fieldType,
        name: body.name,
        description: body.description,
        publiclyVisible: body.publiclyVisible,
        required: body.required,
        ownerEmptyMode: body.ownerEmptyMode,
        publicEmptyMode: body.publicEmptyMode,
        emptyPlaceholder: body.emptyPlaceholder,
        configuration: body.configuration,
      }),
    );
  }

  /**
   * Changes a Field's wording, visibility or settings.
   *
   * @param userId - The caller.
   * @param fieldId - The Field to change.
   * @param body - What to change.
   * @returns The Field as it now stands.
   */
  @Patch('fields/:fieldId')
  @UseGuards(CustomTrackingEditingGuard)
  @ApiOperation({ summary: 'Change a field' })
  @ApiOkResponse({ type: CustomTrackingFieldDto })
  @ApiNotFoundResponse({ description: 'No such field of yours.' })
  @ApiConflictResponse({ description: 'The name is already used.' })
  async update(
    @UserId() userId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Body() body: UpdateCustomTrackingFieldDto,
  ): Promise<CustomTrackingFieldDto> {
    const field = await this._fields.update(userId, fieldId, body);

    return this._mapper.toField(
      field,
      await this._options.list(userId, field.id),
    );
  }

  /**
   * Reports what deleting a Field would take with it.
   *
   * Read before the confirmation is shown. "Delete this field" and "delete
   * this field and the nineteen answers recorded against it" are different
   * decisions, and only one of them is the one being made.
   *
   * @param userId - The caller.
   * @param fieldId - The Field being considered.
   * @returns How many answers would go with it.
   */
  @Get('fields/:fieldId/deletion-impact')
  @ApiOperation({ summary: 'See what deleting a field would remove' })
  @ApiOkResponse({ description: 'Counts of the answers affected.' })
  @ApiNotFoundResponse({ description: 'No such field of yours.' })
  describeDeletion(
    @UserId() userId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
  ): Promise<CustomTrackingDeletionImpact> {
    return this._fields.describeDeletion(userId, fieldId);
  }

  /**
   * Deletes a Field and its options.
   *
   * @param userId - The caller.
   * @param fieldId - The Field to delete.
   */
  @Delete('fields/:fieldId')
  @UseGuards(CustomTrackingEditingGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a field' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiNotFoundResponse({ description: 'No such field of yours.' })
  async remove(
    @UserId() userId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
  ): Promise<void> {
    await this._fields.remove(userId, fieldId);
  }

  /**
   * Puts a Tab's Fields into a new order.
   *
   * @param userId - The caller.
   * @param tabId - The Tab being ordered.
   * @param body - Every live Field in it, in order.
   */
  @Put('tabs/:tabId/fields/order')
  @UseGuards(CustomTrackingEditingGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reorder the fields in a tab' })
  @ApiNoContentResponse({ description: 'Reordered.' })
  @ApiBadRequestResponse({
    description: 'The list is not exactly the fields in this tab.',
  })
  async reorder(
    @UserId() userId: string,
    @Param('tabId', ParseUUIDPipe) tabId: string,
    @Body() body: ReorderCustomTrackingDto,
  ): Promise<void> {
    await this._fields.reorder(userId, tabId, body.orderedIds);
  }
}
