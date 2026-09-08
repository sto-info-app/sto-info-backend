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
  CreateCustomTrackingOptionDto,
  CustomTrackingOptionDto,
  UpdateCustomTrackingOptionDto,
} from '../dto/custom-tracking-option.dto';
import { ReorderCustomTrackingDto } from '../dto/custom-tracking-reorder.dto';
import { CustomTrackingDefinitionMapper } from './custom-tracking-definition.mapper';
import { CustomTrackingOptionService } from './custom-tracking-option.service';

/**
 * The answers a choice or tags Field offers.
 *
 * Withdrawing an option is a soft deletion and stays one. A value that already
 * chose it goes on displaying the wording it had; what changes is that nobody
 * can choose it again.
 */
@ApiTags('Custom Tracking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('custom-tracking')
export class CustomTrackingOptionsController {
  /**
   * Creates an instance of CustomTrackingOptionsController.
   *
   * @param _options - Option behaviour.
   * @param _mapper - Maps options to their response shape.
   */
  constructor(
    private readonly _options: CustomTrackingOptionService,
    private readonly _mapper: CustomTrackingDefinitionMapper,
  ) {}

  /**
   * Lists a Field's options.
   *
   * @param userId - The caller.
   * @param fieldId - The Field whose options are wanted.
   * @returns The options, in order.
   */
  @Get('fields/:fieldId/options')
  @ApiOperation({ summary: 'List the options a field offers' })
  @ApiOkResponse({ type: [CustomTrackingOptionDto] })
  @ApiNotFoundResponse({ description: 'No such field of yours.' })
  async list(
    @UserId() userId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
  ): Promise<CustomTrackingOptionDto[]> {
    const options = await this._options.list(userId, fieldId);

    return options.map(option => this._mapper.toOption(option));
  }

  /**
   * Adds an option to a Field.
   *
   * @param userId - The caller.
   * @param fieldId - The Field to add it to.
   * @param body - What the user asked for.
   * @returns The new option.
   */
  @Post('fields/:fieldId/options')
  @UseGuards(CustomTrackingEditingGuard)
  @ApiOperation({ summary: 'Add an option to a field' })
  @ApiOkResponse({ type: CustomTrackingOptionDto })
  @ApiBadRequestResponse({
    description: 'That kind of field does not choose from a list.',
  })
  @ApiConflictResponse({
    description: 'The field is full or the label is used.',
  })
  async create(
    @UserId() userId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Body() body: CreateCustomTrackingOptionDto,
  ): Promise<CustomTrackingOptionDto> {
    return this._mapper.toOption(
      await this._options.create(userId, fieldId, {
        label: body.label,
        isDefault: body.isDefault,
      }),
    );
  }

  /**
   * Changes an option's wording or whether it is a default.
   *
   * @param userId - The caller.
   * @param optionId - The option to change.
   * @param body - What to change.
   * @returns The option as it now stands.
   */
  @Patch('options/:optionId')
  @UseGuards(CustomTrackingEditingGuard)
  @ApiOperation({ summary: 'Change an option' })
  @ApiOkResponse({ type: CustomTrackingOptionDto })
  @ApiNotFoundResponse({ description: 'No such option of yours.' })
  @ApiConflictResponse({ description: 'The label is already used.' })
  async update(
    @UserId() userId: string,
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @Body() body: UpdateCustomTrackingOptionDto,
  ): Promise<CustomTrackingOptionDto> {
    return this._mapper.toOption(
      await this._options.update(userId, optionId, body),
    );
  }

  /**
   * Withdraws an option.
   *
   * @param userId - The caller.
   * @param optionId - The option to withdraw.
   */
  @Delete('options/:optionId')
  @UseGuards(CustomTrackingEditingGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw an option' })
  @ApiNoContentResponse({ description: 'Withdrawn.' })
  @ApiNotFoundResponse({ description: 'No such option of yours.' })
  async remove(
    @UserId() userId: string,
    @Param('optionId', ParseUUIDPipe) optionId: string,
  ): Promise<void> {
    await this._options.remove(userId, optionId);
  }

  /**
   * Puts a Field's options into a new order.
   *
   * @param userId - The caller.
   * @param fieldId - The Field being ordered.
   * @param body - Every live option on it, in order.
   */
  @Put('fields/:fieldId/options/order')
  @UseGuards(CustomTrackingEditingGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reorder the options a field offers' })
  @ApiNoContentResponse({ description: 'Reordered.' })
  @ApiBadRequestResponse({
    description: 'The list is not exactly the options on this field.',
  })
  async reorder(
    @UserId() userId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Body() body: ReorderCustomTrackingDto,
  ): Promise<void> {
    await this._options.reorder(userId, fieldId, body.orderedIds);
  }
}
