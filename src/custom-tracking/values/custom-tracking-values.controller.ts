import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { CUSTOM_TRACKING_FEATURE_FLAGS } from '../constants/custom-tracking-feature.constants';
import { CustomTrackingFeatureService } from '../custom-tracking-feature.service';
import {
  CustomTrackingRecordDto,
  CustomTrackingTargetDto,
  SaveCustomTrackingRecordDto,
} from '../dto/custom-tracking-record.dto';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingRecordMapper } from './custom-tracking-record.mapper';
import { CustomTrackingTargetService } from './custom-tracking-target.service';
import { CustomTrackingValueEditingGuard } from './custom-tracking-value-editing.guard';
import { CustomTrackingValueService } from './custom-tracking-value.service';

/**
 * Recording values against one of a user's Accounts or Characters.
 *
 * Values are managed only from Settings. Account and Character detail pages
 * display them and offer nothing to edit, which is why there is no per-field
 * write route here at all: a record is saved whole or not at all.
 */
@ApiTags('Custom Tracking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('custom-tracking')
export class CustomTrackingValuesController {
  /**
   * Creates an instance of CustomTrackingValuesController.
   *
   * @param _values - Reading and writing recorded values.
   * @param _targets - The Accounts and Characters available to record against.
   * @param _features - Whether the feature is switched on.
   * @param _mapper - Maps records to their response shape.
   */
  constructor(
    private readonly _values: CustomTrackingValueService,
    private readonly _targets: CustomTrackingTargetService,
    private readonly _features: CustomTrackingFeatureService,
    private readonly _mapper: CustomTrackingRecordMapper,
  ) {}

  /**
   * Lists the caller's records in one scope, as somewhere to record against.
   *
   * @param userId - The caller.
   * @param targetScope - Whether Accounts or Characters are wanted.
   * @returns Their records.
   */
  @Get('scopes/:scope/targets')
  @ApiOperation({ summary: 'List your accounts or characters' })
  @ApiOkResponse({ type: [CustomTrackingTargetDto] })
  async listTargets(
    @UserId() userId: string,
    @Param('scope', new ParseEnumPipe(CustomTrackingTargetScope))
    targetScope: CustomTrackingTargetScope,
  ): Promise<CustomTrackingTargetDto[]> {
    await this._features.assertFlagEnabled(
      CUSTOM_TRACKING_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    const targets = await this._targets.listOwned(userId, targetScope);

    return targets.map(target => this._mapper.toTarget(target));
  }

  /**
   * Loads one record: the definitions applying to it and what is recorded.
   *
   * Not gated on the content agreement. A user whose acceptance has been
   * superseded keeps full sight of everything they have already recorded.
   *
   * @param userId - The caller.
   * @param targetScope - Whether an Account or a Character is wanted.
   * @param targetId - The record wanted.
   * @returns The record.
   */
  @Get('scopes/:scope/targets/:targetId/record')
  @ApiOperation({ summary: 'Load one account or character record' })
  @ApiOkResponse({ type: CustomTrackingRecordDto })
  @ApiNotFoundResponse({ description: 'No such record of yours.' })
  async loadRecord(
    @UserId() userId: string,
    @Param('scope', new ParseEnumPipe(CustomTrackingTargetScope))
    targetScope: CustomTrackingTargetScope,
    @Param('targetId', ParseUUIDPipe) targetId: string,
  ): Promise<CustomTrackingRecordDto> {
    await this._features.assertFlagEnabled(
      CUSTOM_TRACKING_FEATURE_FLAGS.PUBLIC_READ_ENABLED,
    );

    return this._mapper.toRecord(
      await this._values.loadRecord(userId, targetScope, targetId),
    );
  }

  /**
   * Saves one record, whole.
   *
   * Every answer is checked before anything is written, and the whole write
   * runs in one transaction, so a failure anywhere leaves the record exactly
   * as it was rather than leaving the user to work out which of their changes
   * survived.
   *
   * @param userId - The caller.
   * @param targetScope - Whether an Account or a Character is being saved.
   * @param targetId - The record being saved.
   * @param body - The answers being recorded.
   * @returns The record as it now stands.
   */
  @Put('scopes/:scope/targets/:targetId/record')
  @UseGuards(CustomTrackingValueEditingGuard)
  @ApiOperation({ summary: 'Save one account or character record' })
  @ApiOkResponse({ type: CustomTrackingRecordDto })
  @ApiNotFoundResponse({ description: 'No such record of yours.' })
  @ApiForbiddenResponse({ description: 'The content agreement is unaccepted.' })
  @ApiBadRequestResponse({
    description:
      'An answer is unacceptable, or a required field still has none.',
  })
  async saveRecord(
    @UserId() userId: string,
    @Param('scope', new ParseEnumPipe(CustomTrackingTargetScope))
    targetScope: CustomTrackingTargetScope,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @Body() body: SaveCustomTrackingRecordDto,
  ): Promise<CustomTrackingRecordDto> {
    return this._mapper.toRecord(
      await this._values.saveRecord(
        userId,
        targetScope,
        targetId,
        body.answers.map(answer => ({
          fieldId: answer.fieldId,
          value: answer.value,
        })),
      ),
    );
  }
}
