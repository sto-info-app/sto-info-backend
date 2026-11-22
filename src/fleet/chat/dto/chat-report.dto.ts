import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

import { ReportReason } from 'src/moderation/enums/report-reason.enum';
import { ReportStatus } from 'src/moderation/enums/report-status.enum';
import { PaginatedQueryDto } from 'src/shared/dto/paginated-query.dto';

import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { ChatPersonDto } from './chat.dto';

/** The longest details a reporter or a note an admin may give. */
export const CHAT_REPORT_TEXT_MAX_LENGTH = 1000;

/**
 * Trims a string, leaving anything else for the validators to refuse.
 *
 * @param value - What was sent.
 * @returns It, trimmed where it is text.
 */
function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** A reader's report of a message (FC-035). */
export class ChatReportDto {
  @ApiProperty({ enum: ReportReason, example: ReportReason.HARASSMENT })
  @IsEnum(ReportReason)
  readonly reason: ReportReason;

  @ApiPropertyOptional({
    description: 'What happened, in the reporter’s own words.',
    maxLength: CHAT_REPORT_TEXT_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(CHAT_REPORT_TEXT_MAX_LENGTH)
  readonly details?: string;
}

/** The admin queue's filters. */
export class ChatReportsQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  readonly status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportReason })
  @IsOptional()
  @IsEnum(ReportReason)
  readonly reason?: ReportReason;
}

/** The statuses that close a report. */
export const CHAT_REPORT_CLOSED = [
  ReportStatus.ACTIONED,
  ReportStatus.DISMISSED,
] as const;

/** An admin closing a report: resolved or dismissed, with a note. */
export class ChatReportDecisionDto {
  @ApiProperty({ enum: CHAT_REPORT_CLOSED, example: ReportStatus.DISMISSED })
  @IsIn(CHAT_REPORT_CLOSED)
  readonly status: (typeof CHAT_REPORT_CLOSED)[number];

  @ApiProperty({
    description:
      'What was found or done, and why: required, and kept in the site admin ' +
      'log (FC-039). Never shown to the reporter.',
    maxLength: CHAT_REPORT_TEXT_MAX_LENGTH,
  })
  @Transform(trimmed)
  @IsString()
  @Length(1, CHAT_REPORT_TEXT_MAX_LENGTH)
  readonly note: string;
}

/** An admin removing a reported message. */
export class ChatReportRemovalDto {
  @ApiProperty({ description: 'Why. Logged.', maxLength: 500 })
  @Transform(trimmed)
  @IsString()
  @Length(1, 500)
  readonly reason: string;
}

/** Where a reported message was. */
export class ChatReportPlaceDto {
  @ApiProperty({ enum: ['CHANNEL', 'DIRECT'] }) kind: 'CHANNEL' | 'DIRECT';

  @ApiProperty({ nullable: true, type: String }) channelId: string | null;

  @ApiProperty({ nullable: true, type: String }) channelName: string | null;

  @ApiProperty({ nullable: true, enum: FleetScopeKind })
  scopeKind: FleetScopeKind | null;

  @ApiProperty({ nullable: true, type: String }) scopeName: string | null;

  @ApiProperty({ nullable: true, type: String }) conversationId: string | null;
}

/** A report in the admin queue. */
export class ChatReportSummaryDto {
  @ApiProperty() id: string;

  @ApiProperty() messageId: string;

  @ApiProperty({ type: ChatReportPlaceDto }) place: ChatReportPlaceDto;

  @ApiProperty({ nullable: true, type: ChatPersonDto })
  reporter: ChatPersonDto | null;

  @ApiProperty({ nullable: true, type: ChatPersonDto })
  author: ChatPersonDto | null;

  @ApiProperty({ enum: ReportReason }) reason: ReportReason;

  @ApiProperty({ nullable: true, type: String }) details: string | null;

  @ApiProperty({ enum: ReportStatus }) status: ReportStatus;

  @ApiProperty() createdAt: Date;

  @ApiProperty({
    description: 'Open member reports about its author (FC-036).',
  })
  openUserReportCount: number;
}

/** One message held as evidence. */
export class ChatReportEvidenceDto {
  @ApiProperty({ description: '0 for the reported message, then back.' })
  position: number;

  @ApiProperty() messageId: string;

  @ApiProperty({ nullable: true, type: ChatPersonDto })
  author: ChatPersonDto | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Null for a message deleted before the report.',
  })
  body: string | null;

  @ApiProperty() deleted: boolean;

  @ApiProperty() sentAt: Date;
}

/** A report, with its evidence and what was decided. */
export class ChatReportDetailDto extends ChatReportSummaryDto {
  @ApiProperty({ type: [ChatReportEvidenceDto], description: 'Oldest first.' })
  evidence: ChatReportEvidenceDto[];

  @ApiProperty({
    description:
      'Whether the reported message has since been deleted or removed.',
  })
  messageRemoved: boolean;

  @ApiProperty({ nullable: true, type: String }) resolutionNote: string | null;

  @ApiProperty({ nullable: true, type: ChatPersonDto })
  resolvedBy: ChatPersonDto | null;

  @ApiProperty({ nullable: true, type: Date }) resolvedAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The hold keeping its evidence, while one is in force (FC-036).',
  })
  holdId: string | null;
}

/** A page of the admin queue. */
export class ChatReportPageDto {
  @ApiProperty({ type: [ChatReportSummaryDto] })
  items: ChatReportSummaryDto[];

  @ApiProperty() total: number;

  @ApiProperty() page: number;

  @ApiProperty() pageSize: number;

  @ApiProperty({ description: 'Open reports across the whole queue.' })
  openCount: number;
}
