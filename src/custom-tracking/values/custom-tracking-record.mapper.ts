import { Injectable } from '@nestjs/common';

import { CustomTrackingDefinitionMapper } from '../definitions/custom-tracking-definition.mapper';
import {
  CustomTrackingRecordDto,
  CustomTrackingStoredAnswerDto,
  CustomTrackingTargetDto,
} from '../dto/custom-tracking-record.dto';
import { CustomTrackingTarget } from './custom-tracking-target.service';
import {
  CustomTrackingRecord,
  CustomTrackingStoredAnswer,
} from './custom-tracking-value.service';

/**
 * Turning a loaded record into what its owner is sent.
 *
 * The definitions go through the same mapper the builder uses, so a property
 * withheld there — the administrator who suppressed something, the moment an
 * option was withdrawn — is withheld here too rather than leaking through a
 * second route to the same data.
 *
 * This is still the owner's view. The public projection is separate and has
 * the whole visibility chain behind it.
 */
@Injectable()
export class CustomTrackingRecordMapper {
  /**
   * Creates an instance of CustomTrackingRecordMapper.
   *
   * @param _definitions - Maps definitions to their response shape.
   */
  constructor(private readonly _definitions: CustomTrackingDefinitionMapper) {}

  /**
   * Maps a whole record.
   *
   * @param record - The loaded record.
   * @returns What its owner is sent.
   */
  toRecord(record: CustomTrackingRecord): CustomTrackingRecordDto {
    return {
      target: this.toTarget(record.target),
      sections: record.sections.map(section =>
        this._definitions.toSectionTree(section),
      ),
      answers: record.answers.map(answer => this.toAnswer(answer)),
    };
  }

  /**
   * Maps one of a user's STO records.
   *
   * @param target - The Account or Character.
   * @returns What its owner is sent.
   */
  toTarget(target: CustomTrackingTarget): CustomTrackingTargetDto {
    return {
      scope: target.scope,
      id: target.id,
      label: target.label,
      publiclyVisible: target.publiclyVisible,
    };
  }

  /**
   * Maps a Section and everything beneath it.
   *
   * @param node - The Section, with its Tabs and their Fields.
   * @returns What its owner is sent.
   */
  private toAnswer(
    answer: CustomTrackingStoredAnswer,
  ): CustomTrackingStoredAnswerDto {
    return {
      fieldId: answer.fieldId,
      value: answer.fragment as Record<string, unknown> | null,
      optionIds: [...answer.optionIds],
      image: answer.image
        ? {
            imageId: answer.image.cloudflareImageId,
            altText: answer.image.altText,
            shape: answer.image.shape,
          }
        : null,
    };
  }
}
