import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** The longest a policy version identifier may be. */
const MAX_POLICY_VERSION_LENGTH = 20;

/**
 * Accepting the content agreement.
 *
 * The version the interface displayed is required. A page left open across a
 * wording change would otherwise record agreement to terms the user never saw,
 * which is the one thing an acceptance record exists to rule out.
 */
export class AcceptCustomTrackingPolicyDto {
  @ApiProperty({
    description: 'The exact agreement version that was shown and read.',
    example: '1.0',
    maxLength: MAX_POLICY_VERSION_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_POLICY_VERSION_LENGTH)
  acceptedVersion: string;
}

/**
 * One part of the agreement, as the interface renders it.
 */
export class CustomTrackingAgreementSectionDto {
  @ApiProperty({ description: 'The heading.', nullable: true })
  heading: string | null;

  @ApiProperty({ description: 'Paragraphs, in order.', type: [String] })
  paragraphs: string[];

  @ApiProperty({ description: 'Bulleted points, in order.', type: [String] })
  bullets: string[];
}

/**
 * The agreement a user reads before accepting.
 *
 * Structured rather than a block of markup, so the interface can style it and
 * a screen reader meets a heading and a list rather than a paragraph
 * containing bullet characters.
 */
export class CustomTrackingAgreementDto {
  @ApiProperty({
    description: 'The version an acceptance is recorded against.',
  })
  version: string;

  @ApiProperty({ description: 'When this wording took effect.' })
  effectiveDate: string;

  @ApiProperty({ description: 'When this wording was last changed.' })
  updatedDate: string;

  @ApiProperty({ description: 'The agreement title.' })
  title: string;

  @ApiProperty({
    description: 'The content, in reading order.',
    type: [CustomTrackingAgreementSectionDto],
  })
  sections: CustomTrackingAgreementSectionDto[];
}

/**
 * Where a user stands with the agreement.
 */
export class CustomTrackingPolicyStatusDto {
  @ApiProperty({ description: 'The version currently published.' })
  currentVersion: string;

  @ApiProperty({ description: 'When the current wording took effect.' })
  effectiveDate: string;

  @ApiProperty({ description: 'When the current wording was last changed.' })
  updatedDate: string;

  @ApiProperty({
    description: 'The version last accepted, or null if never.',
    nullable: true,
  })
  acceptedVersion: string | null;

  @ApiProperty({ description: 'When it was accepted.', nullable: true })
  acceptedAt: Date | null;

  @ApiProperty({
    description:
      'Whether acceptance is needed before anything may be created or changed. Reading is never gated.',
  })
  acceptanceRequired: boolean;
}
