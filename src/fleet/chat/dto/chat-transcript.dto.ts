import { ApiProperty } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import { IsDate, IsString, Length } from 'class-validator';

import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { ChatTranscriptStatus } from '../enums/chat.enums';

/** The shortest purpose a transcript may give, in characters. */
export const CHAT_TRANSCRIPT_PURPOSE_MIN_LENGTH = 10;

/** The longest purpose a transcript may give, in characters. */
export const CHAT_TRANSCRIPT_PURPOSE_MAX_LENGTH = 500;

/**
 * A scope admin's request for a transcript of one channel (FC-035).
 *
 * The range is checked against the server's clock in the service, not here:
 * a validator would read the clock before the request is handled.
 */
export class ChatTranscriptRequestDto {
  @ApiProperty({ description: 'The first instant, within the last 7 days.' })
  @Type(() => Date)
  @IsDate()
  readonly fromAt: Date;

  @ApiProperty({ description: 'The last instant; later than fromAt.' })
  @Type(() => Date)
  @IsDate()
  readonly toAt: Date;

  @ApiProperty({
    description: 'Why it is needed. Logged, and printed in its header.',
    minLength: CHAT_TRANSCRIPT_PURPOSE_MIN_LENGTH,
    maxLength: CHAT_TRANSCRIPT_PURPOSE_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(
    CHAT_TRANSCRIPT_PURPOSE_MIN_LENGTH,
    CHAT_TRANSCRIPT_PURPOSE_MAX_LENGTH,
  )
  readonly purpose: string;
}

/** A transcript its requester asked for. */
export class ChatTranscriptDto {
  @ApiProperty() id: string;

  @ApiProperty() channelId: string;

  @ApiProperty() channelName: string;

  @ApiProperty({ enum: FleetScopeKind }) scopeKind: FleetScopeKind;

  @ApiProperty({ nullable: true, type: String }) scopeName: string | null;

  @ApiProperty() purpose: string;

  @ApiProperty() fromAt: Date;

  @ApiProperty() toAt: Date;

  @ApiProperty({ enum: ChatTranscriptStatus }) status: ChatTranscriptStatus;

  @ApiProperty({ nullable: true, type: Number }) messageCount: number | null;

  @ApiProperty() createdAt: Date;

  @ApiProperty({ nullable: true, type: Date }) readyAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'When its download link stops working.',
  })
  expiresAt: Date | null;
}
