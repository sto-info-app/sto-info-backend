import { ApiProperty } from '@nestjs/swagger';

import { CustomTrackingEmptyMode } from '../enums/custom-tracking-empty-mode.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingImageAnswerDto } from './custom-tracking-record.dto';

/**
 * One option a public value chose.
 *
 * Only the chosen ones are published. The rest of the list is the owner's
 * working vocabulary — every category they considered and rejected — and a
 * visitor reading a Character's page has no business seeing it.
 */
export class CustomTrackingPublicChoiceDto {
  @ApiProperty({ description: 'The option chosen.' })
  id: string;

  @ApiProperty({ description: 'What it is called.' })
  label: string;
}

/**
 * A publicly visible Field and what is recorded against it.
 *
 * The empty mode has already been resolved to the public one, and a Field that
 * is empty and configured to hide is not here at all. Deciding that in the
 * browser would mean sending the visitor something they were never entitled
 * to and trusting the page not to draw it.
 */
export class CustomTrackingPublicFieldDto {
  @ApiProperty({ description: 'The Field.' })
  id: string;

  @ApiProperty({
    description: 'What kind of answer it holds.',
    enum: CustomTrackingFieldType,
  })
  fieldType: CustomTrackingFieldType;

  @ApiProperty({ description: 'What it is called.' })
  name: string;

  @ApiProperty({
    description: 'What it is for, if the owner said.',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    description: 'How the answer is written out.',
    type: Object,
  })
  configuration: Record<string, unknown>;

  @ApiProperty({
    description: 'What to show where there is no answer.',
    enum: CustomTrackingEmptyMode,
  })
  emptyMode: CustomTrackingEmptyMode;

  @ApiProperty({
    description: 'The words to show in place of a missing answer.',
    nullable: true,
  })
  emptyPlaceholder: string | null;

  @ApiProperty({
    description: 'The typed answer, for the types that store one.',
    nullable: true,
    type: Object,
  })
  value: Record<string, unknown> | null;

  @ApiProperty({
    description: 'The options chosen, in the order they were chosen.',
    type: [CustomTrackingPublicChoiceDto],
  })
  chosen: CustomTrackingPublicChoiceDto[];

  @ApiProperty({
    description: 'The picture, for an image Field that has one.',
    nullable: true,
    type: CustomTrackingImageAnswerDto,
  })
  image: CustomTrackingImageAnswerDto | null;
}

/**
 * A publicly visible Tab and the Fields left in it.
 */
export class CustomTrackingPublicTabDto {
  @ApiProperty({ description: 'The Tab.' })
  id: string;

  @ApiProperty({ description: 'What it is called.' })
  name: string;

  @ApiProperty({
    description: 'What it is for, if the owner said.',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    description: 'The Fields a visitor may see, in order.',
    type: [CustomTrackingPublicFieldDto],
  })
  fields: CustomTrackingPublicFieldDto[];
}

/**
 * A publicly visible Section and the Tabs left in it.
 */
export class CustomTrackingPublicSectionDto {
  @ApiProperty({ description: 'The Section.' })
  id: string;

  @ApiProperty({ description: 'What it is called.' })
  name: string;

  @ApiProperty({
    description: 'What it is for, if the owner said.',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    description: 'The Tabs a visitor may see, in order.',
    type: [CustomTrackingPublicTabDto],
  })
  tabs: CustomTrackingPublicTabDto[];
}
