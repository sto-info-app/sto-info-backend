import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

import { ChatReportPlaceDto } from '../dto/chat-report.dto';
import { CHAT_CURSOR_PATTERN, ChatPersonDto } from '../dto/chat.dto';
import {
  ModerationHoldActionKind,
  ModerationHoldKind,
} from './moderation-hold.enums';

/**
 * Trims a string, leaving anything else for the validators to refuse.
 *
 * @param value - What was sent.
 * @returns It, trimmed where it is text.
 */
function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Placing a hold (FC-036). */
export class ModerationHoldPlaceDto {
  @ApiProperty({ enum: ModerationHoldKind })
  @IsEnum(ModerationHoldKind)
  readonly kind: ModerationHoldKind;

  @ApiPropertyOptional({ description: 'The report, for CHAT_REPORT.' })
  @ValidateIf(
    (dto: ModerationHoldPlaceDto) =>
      dto.kind === ModerationHoldKind.CHAT_REPORT,
  )
  @IsUUID()
  readonly chatReportId?: string;

  @ApiPropertyOptional({ description: 'The member, for MEMBER_MESSAGES.' })
  @ValidateIf(
    (dto: ModerationHoldPlaceDto) =>
      dto.kind === ModerationHoldKind.MEMBER_MESSAGES,
  )
  @IsUUID()
  readonly subjectUserId?: string;

  @ApiProperty({ maxLength: 500 })
  @Transform(trimmed)
  @IsString()
  @Length(1, 500)
  readonly reason: string;

  @ApiPropertyOptional({
    description:
      'When to review it: at most 180 days ahead, and 180 by default.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  readonly reviewAt?: Date;
}

/** Extending a hold's review date, with a reason. */
export class ModerationHoldExtendDto {
  @ApiProperty({ description: 'The new review date, at most 180 days ahead.' })
  @Type(() => Date)
  @IsDate()
  readonly reviewAt: Date;

  @ApiProperty({ maxLength: 500 })
  @Transform(trimmed)
  @IsString()
  @Length(1, 500)
  readonly reason: string;
}

/** Releasing a hold, with a reason. */
export class ModerationHoldReleaseDto {
  @ApiProperty({ maxLength: 500 })
  @Transform(trimmed)
  @IsString()
  @Length(1, 500)
  readonly reason: string;
}

/** Reading what a hold keeps, with a purpose, logged. */
export class ModerationHoldReadDto {
  @ApiProperty({ minLength: 10, maxLength: 500 })
  @Transform(trimmed)
  @IsString()
  @Length(10, 500)
  readonly purpose: string;

  @ApiPropertyOptional({ description: 'Read the page before this cursor.' })
  @IsOptional()
  @Matches(CHAT_CURSOR_PATTERN, { message: 'before is not a chat cursor' })
  readonly before?: string;
}

/** The holds list's filter. */
export class ModerationHoldsQueryDto {
  @ApiPropertyOptional({ description: 'Only holds still in force.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  readonly active?: boolean;
}

/** A hold, as site admins see it. */
export class ModerationHoldDto {
  @ApiProperty() id: string;

  @ApiProperty({ enum: ModerationHoldKind }) kind: ModerationHoldKind;

  @ApiProperty({ nullable: true, type: String }) chatReportId: string | null;

  @ApiProperty({
    nullable: true,
    type: ChatPersonDto,
    description: 'Whose messages are kept, or whose reported message.',
  })
  subject: ChatPersonDto | null;

  @ApiProperty() reason: string;

  @ApiProperty({ nullable: true, type: ChatPersonDto })
  owner: ChatPersonDto | null;

  @ApiProperty() reviewAt: Date;

  @ApiProperty({ description: 'Whether its review date has come.' })
  reviewDue: boolean;

  @ApiProperty({
    nullable: true,
    type: Date,
    description:
      'When the system releases it unless somebody extends it first ' +
      '(FC-037); null once released.',
  })
  releasesAt: Date | null;

  @ApiProperty() createdAt: Date;

  @ApiProperty({ nullable: true, type: Date }) releasedAt: Date | null;

  @ApiProperty({ nullable: true, type: ChatPersonDto })
  releasedBy: ChatPersonDto | null;

  @ApiProperty({ nullable: true, type: String }) releaseReason: string | null;
}

/** One entry in a hold's log. */
export class ModerationHoldActionDto {
  @ApiProperty({ enum: ModerationHoldActionKind })
  action: ModerationHoldActionKind;

  @ApiProperty({ nullable: true, type: ChatPersonDto })
  actor: ChatPersonDto | null;

  @ApiProperty({
    description:
      'Whether the system did it, at a review date, rather than a site ' +
      'admin (FC-037).',
  })
  automatic: boolean;

  @ApiProperty({ description: 'Why, or for a reading, its purpose.' })
  reason: string;

  @ApiProperty() createdAt: Date;
}

/** A hold with its log. */
export class ModerationHoldDetailDto extends ModerationHoldDto {
  @ApiProperty({
    type: [ModerationHoldActionDto],
    description: 'Newest first.',
  })
  actions: ModerationHoldActionDto[];
}

/** One kept message. */
export class HeldMessageDto {
  @ApiProperty() id: string;

  @ApiProperty({ type: ChatReportPlaceDto }) place: ChatReportPlaceDto;

  @ApiProperty({
    nullable: true,
    type: ChatPersonDto,
    description: 'The other side, for a direct message.',
  })
  with: ChatPersonDto | null;

  @ApiProperty({ nullable: true, type: ChatPersonDto })
  author: ChatPersonDto | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'What it said, even once deleted; null only where the evidence never held it.',
  })
  body: string | null;

  @ApiProperty() deleted: boolean;

  @ApiProperty() sentAt: Date;
}

/** A page of kept messages, newest first. */
export class HeldMessagePageDto {
  @ApiProperty({ type: [HeldMessageDto] }) messages: HeldMessageDto[];

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Where the page before starts, or null at the start.',
  })
  before: string | null;
}
