import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ChatChannelKind } from '../enums/chat.enums';

/** The most a message may say, in characters (Steve's decision). */
export const CHAT_MESSAGE_MAX_LENGTH = 2000;

/** The most people one message may mention. */
export const CHAT_MENTIONS_MAX = 20;

/** How much of an answered message a reply shows, in characters. */
export const CHAT_REPLY_EXCERPT_LENGTH = 80;

/** The longest channel name. */
export const CHAT_CHANNEL_NAME_MAX_LENGTH = 50;

/** Where a page of messages carries on from: `<ISO instant>_<message ID>`. */
export const CHAT_CURSOR_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z_[0-9a-f-]{36}$/;

/**
 * Trims a string, leaving anything else for the validators to refuse.
 *
 * @param value - What was sent.
 * @returns It, trimmed where it is text.
 */
function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** A custom channel as its moderator writes it. */
export class ChatChannelInputDto {
  @ApiProperty({ maxLength: CHAT_CHANNEL_NAME_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @Length(1, CHAT_CHANNEL_NAME_MAX_LENGTH)
  readonly name: string;

  @ApiProperty({
    enum: FleetScopeRole,
    description: 'The least role that reads it.',
  })
  @IsEnum(FleetScopeRole)
  readonly readRole: FleetScopeRole;

  @ApiPropertyOptional({
    enum: FleetScopeRole,
    description:
      'The least role that posts in it; the reading role when left out, and never lower.',
  })
  @IsOptional()
  @IsEnum(FleetScopeRole)
  readonly postRole?: FleetScopeRole;
}

/** A channel, and what the reader may do there. */
export class ChatChannelDto {
  @ApiProperty() id: string;

  @ApiProperty({ enum: ChatChannelKind }) kind: ChatChannelKind;

  @ApiProperty() name: string;

  @ApiProperty({ enum: FleetScopeRole }) readRole: FleetScopeRole;

  @ApiProperty({ enum: FleetScopeRole }) postRole: FleetScopeRole;

  @ApiProperty() mayPost: boolean;

  @ApiProperty({ description: 'Whether they may rename or archive it.' })
  mayManage: boolean;

  @ApiProperty({ description: 'Whether they may report its messages.' })
  mayReport: boolean;
}

/** Where a scope's channels are. */
export class ChatScopeTargetDto {
  @ApiProperty() communityId: string;

  @ApiProperty({ nullable: true, type: String }) fleetId: string | null;

  @ApiProperty({ nullable: true, type: String }) armadaId: string | null;
}

/** One scope's channels, among somebody's own. */
export class ChatScopeChannelsDto {
  @ApiProperty({ enum: FleetScopeKind }) kind: FleetScopeKind;

  @ApiProperty() name: string;

  @ApiProperty({ description: 'Its page on the site.' }) path: string;

  @ApiProperty({ type: ChatScopeTargetDto }) target: ChatScopeTargetDto;

  @ApiProperty({ description: 'Whether they may add a channel here.' })
  mayCreate: boolean;

  @ApiProperty({
    description: 'Whether they may export its channels’ transcripts.',
  })
  mayExport: boolean;

  @ApiProperty({ type: [ChatChannelDto] }) channels: ChatChannelDto[];
}

/** Somebody named in chat. */
export class ChatPersonDto {
  @ApiProperty() userId: string;

  @ApiProperty({ nullable: true, type: String }) username: string | null;
}

/**
 * The message a reply answers: its author and its first words, or neither
 * once it is deleted, older than the window or no longer visible.
 */
export class ChatReplyDto {
  @ApiProperty() id: string;

  @ApiProperty({ nullable: true, type: ChatPersonDto })
  author: ChatPersonDto | null;

  @ApiProperty({
    description: `Its first ${CHAT_REPLY_EXCERPT_LENGTH} characters, or null.`,
    nullable: true,
    type: String,
  })
  excerpt: string | null;
}

/** One message, as a reader may see it. */
export class ChatMessageDto {
  @ApiProperty() id: string;

  @ApiProperty({ nullable: true, type: String }) channelId: string | null;

  @ApiProperty({ nullable: true, type: String }) conversationId: string | null;

  @ApiProperty({
    description: 'Who wrote it, or null once their account has gone.',
    nullable: true,
    type: ChatPersonDto,
  })
  author: ChatPersonDto | null;

  @ApiProperty({
    description: 'What it says, or null once it was deleted.',
    nullable: true,
    type: String,
  })
  body: string | null;

  @ApiProperty() clientMessageId: string;

  @ApiProperty() createdAt: Date;

  @ApiProperty() deleted: boolean;

  @ApiProperty({
    description:
      'Whether it was deleted by somebody other than its author: a ' +
      'moderator or a site admin removing it (FC-050).',
  })
  removed: boolean;

  @ApiProperty({ description: 'Whether the reader wrote it.' }) mine: boolean;

  @ApiProperty({
    description:
      'Whether it is from somebody on the other side of a block from the reader, and so shows nobody and nothing (FC-034).',
  })
  hidden: boolean;

  @ApiProperty({
    type: [ChatPersonDto],
    description: 'Who it names, each able to read its place.',
  })
  mentions: ChatPersonDto[];

  @ApiProperty({ nullable: true, type: ChatReplyDto })
  replyTo: ChatReplyDto | null;
}

/** A page of messages, newest last. */
export class ChatMessagePageDto {
  @ApiProperty({ type: [ChatMessageDto] }) messages: ChatMessageDto[];

  @ApiProperty({
    description: 'Where the page before starts, or null at the four-hour edge.',
    nullable: true,
    type: String,
  })
  before: string | null;
}

/** Which messages to read. */
export class ChatMessagesQueryDto {
  @ApiPropertyOptional({ description: 'Carry on before this message.' })
  @IsOptional()
  @Matches(CHAT_CURSOR_PATTERN, { message: 'before is not a chat cursor' })
  readonly before?: string;

  @ApiPropertyOptional({ description: 'Carry on after this message.' })
  @IsOptional()
  @Matches(CHAT_CURSOR_PATTERN, { message: 'after is not a chat cursor' })
  readonly after?: string;

  @ApiPropertyOptional({ description: 'Words to search for, in the window.' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(1, 100)
  readonly q?: string;
}

/** Who a message mentions, and what it answers. */
class ChatPostOptionsDto {
  @ApiPropertyOptional({
    type: [String],
    maxItems: CHAT_MENTIONS_MAX,
    description:
      'Who was picked from the list as it was typed; anybody who cannot read the place is dropped.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHAT_MENTIONS_MAX)
  @IsUUID('all', { each: true })
  readonly mentions?: string[];

  @ApiPropertyOptional({
    description: 'A message in the same place, within the window.',
  })
  @IsOptional()
  @IsUUID()
  readonly replyToMessageId?: string;
}

/** A message to post. */
export class ChatPostDto extends ChatPostOptionsDto {
  @ApiProperty({ maxLength: CHAT_MESSAGE_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @Length(1, CHAT_MESSAGE_MAX_LENGTH)
  readonly body: string;

  @ApiProperty({
    description: 'Chosen by the client, so a resend is the same message.',
  })
  @IsUUID()
  readonly clientMessageId: string;
}

/** Whom to look for, to mention. */
export class ChatPeopleQueryDto {
  @ApiProperty({ description: 'The start of their username.' })
  @Transform(trimmed)
  @IsString()
  @Length(1, 50)
  readonly q: string;
}

/** Why a moderator removed a message. */
export class ChatRemoveDto {
  @ApiPropertyOptional({
    description: 'Why, when removing somebody else’s message.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  readonly reason?: string;
}

/** Whose presence to ask about (FC-034). */
export class ChatPresenceQueryDto {
  @ApiProperty({
    description: 'Up to fifty usernames, separated by commas.',
    example: 'Kira,Odo',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map(each => each.trim())
          .filter(each => each.length > 0)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 50, { each: true })
  readonly usernames: string[];
}

/** Whether somebody is online, as the viewer may know it. */
export class ChatPresenceDto {
  @ApiProperty() username: string;

  @ApiProperty({
    description:
      'True while they have STO Info open and the viewer is in the audience they chose.',
  })
  online: boolean;
}

/**
 * Who to talk to: the friend, or the friendship (FC-033), since a public
 * profile names the friendship and never the person's ID. One or the other.
 */
export class ChatOpenConversationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() readonly userId?: string;

  @ApiPropertyOptional({
    description: 'The friendship, instead of the friend.',
  })
  @IsOptional()
  @IsUUID()
  readonly friendshipId?: string;
}

/** A conversation with a friend. */
export class ChatConversationDto {
  @ApiProperty() id: string;

  @ApiProperty({ type: ChatPersonDto }) other: ChatPersonDto;
}

/** A place named over the chat socket: one channel or one conversation. */
export class ChatPlaceDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() readonly channelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  readonly conversationId?: string;
}

/** Joining a place over the chat socket. */
export class ChatJoinDto extends ChatPlaceDto {
  @ApiPropertyOptional({
    description: 'The last message the client holds, to read what came after.',
  })
  @IsOptional()
  @Matches(CHAT_CURSOR_PATTERN, { message: 'after is not a chat cursor' })
  readonly after?: string;
}

/** Posting over the chat socket. */
export class ChatSendDto extends ChatPlaceDto {
  @ApiPropertyOptional({ type: [String], maxItems: CHAT_MENTIONS_MAX })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHAT_MENTIONS_MAX)
  @IsUUID('all', { each: true })
  readonly mentions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  readonly replyToMessageId?: string;

  @ApiProperty({ maxLength: CHAT_MESSAGE_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @Length(1, CHAT_MESSAGE_MAX_LENGTH)
  readonly body: string;

  @ApiProperty({
    description: 'Chosen by the client, so a resend is the same message.',
  })
  @IsUUID()
  readonly clientMessageId: string;
}
