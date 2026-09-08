import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingSectionTreeDto } from './custom-tracking-tree.dto';

/**
 * One Field's answer, as it is submitted.
 *
 * The value is deliberately untyped here. What belongs in it depends entirely
 * on the Field's type, which the request does not get to assert: the service
 * looks the Field up and checks the answer against the type and configuration
 * it actually has.
 */
export class CustomTrackingAnswerDto {
  @ApiProperty({ description: 'The Field being answered.' })
  @IsUUID('4')
  fieldId: string;

  @ApiProperty({
    description:
      'What was entered, shaped by the Field’s type, or null to clear the answer.',
    nullable: true,
    type: Object,
  })
  @IsDefined()
  @IsOptional()
  @IsObject()
  value: Record<string, unknown> | null;
}

/**
 * Saving a whole record at once.
 *
 * A whole record rather than one Field at a time, because the required-field
 * rule is a statement about the record: saving field by field would let one
 * come to rest half-written, with some required answers present and others
 * missing, which is the state that rule exists to prevent.
 */
export class SaveCustomTrackingRecordDto {
  @ApiProperty({
    description: 'Every answer being recorded.',
    type: [CustomTrackingAnswerDto],
  })
  @IsArray()
  @ArrayMaxSize(CUSTOM_TRACKING_LIMITS.MAX_FIELDS_PER_SCOPE)
  @ValidateNested({ each: true })
  @Type(() => CustomTrackingAnswerDto)
  answers: CustomTrackingAnswerDto[];
}

/**
 * The picture answering an image Field.
 */
export class CustomTrackingImageAnswerDto {
  @ApiProperty({ description: 'Cloudflare Images identifier.' })
  imageId: string;

  @ApiProperty({ description: 'What the picture shows.' })
  altText: string;

  @ApiProperty({
    description: 'The shape it was cropped to.',
    enum: CustomTrackingImageShape,
  })
  shape: CustomTrackingImageShape;
}

/**
 * One Field's answer, as it stands.
 */
export class CustomTrackingStoredAnswerDto {
  @ApiProperty({ description: 'The Field answered.' })
  fieldId: string;

  @ApiProperty({
    description: 'The typed answer, for the types that store one.',
    nullable: true,
    type: Object,
  })
  value: Record<string, unknown> | null;

  @ApiProperty({
    description: 'The options chosen, for the types that draw from a list.',
    type: [String],
  })
  optionIds: string[];

  @ApiProperty({
    description: 'The picture, for an image Field that has one.',
    nullable: true,
    type: CustomTrackingImageAnswerDto,
  })
  image: CustomTrackingImageAnswerDto | null;
}

/**
 * One of a user's STO records, as somewhere to record against.
 */
export class CustomTrackingTargetDto {
  @ApiProperty({
    description: 'Whether this is an Account or a Character.',
    enum: CustomTrackingTargetScope,
  })
  scope: CustomTrackingTargetScope;

  @ApiProperty({ description: 'The record’s identifier.' })
  id: string;

  @ApiProperty({ description: 'What to call it.' })
  label: string;

  @ApiProperty({ description: 'Whether the record itself is public.' })
  publiclyVisible: boolean;
}

/**
 * Everything needed to edit one record.
 */
export class CustomTrackingRecordDto {
  @ApiProperty({
    description: 'The Account or Character being described.',
    type: CustomTrackingTargetDto,
  })
  target: CustomTrackingTargetDto;

  @ApiProperty({
    description: 'The definitions applying to it, with their tabs and fields.',
    type: [CustomTrackingSectionTreeDto],
  })
  sections: CustomTrackingSectionTreeDto[];

  @ApiProperty({
    description: 'What has been recorded so far.',
    type: [CustomTrackingStoredAnswerDto],
  })
  answers: CustomTrackingStoredAnswerDto[];
}
