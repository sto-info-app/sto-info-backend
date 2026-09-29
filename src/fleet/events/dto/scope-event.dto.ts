import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import {
  EventRecurrence,
  OccurrenceAdjustment,
} from '../enums/event-recurrence.enum';
import {
  OccurrenceStatus,
  REMINDER_LEADS,
  RsvpResponse,
  ScopeEventActionKind,
  ScopeEventAudience,
  ScopeEventStatus,
} from '../enums/scope-event.enums';

/** The longest title an event may have. */
export const EVENT_TITLE_MAX_LENGTH = 200;

/** The longest description an event may have. */
export const EVENT_DESCRIPTION_MAX_LENGTH = 20000;

/** A day, as `YYYY-MM-DD`. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A time of day, as `HH:mm`. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** An event, as its organiser writes it. Sent whole on every save. */
export class ScopeEventDefinitionDto {
  @ApiProperty({ maxLength: EVENT_TITLE_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please give the event a title' })
  @MaxLength(EVENT_TITLE_MAX_LENGTH)
  readonly title: string;

  @ApiPropertyOptional({
    description: 'Markdown.',
    maxLength: EVENT_DESCRIPTION_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(EVENT_DESCRIPTION_MAX_LENGTH)
  readonly description?: string;

  @ApiPropertyOptional({
    description: 'One https link, such as a Discord event.',
    nullable: true,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2048)
  @Matches(/^https:\/\/[^\s]+$/, {
    message: 'The link must be a web address starting https://',
  })
  readonly externalUrl?: string | null;

  @ApiProperty({ enum: ScopeEventAudience })
  @IsEnum(ScopeEventAudience)
  readonly audience: ScopeEventAudience;

  @ApiPropertyOptional({
    description: 'For a SELECTED audience: the chosen Fleets.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  readonly audienceFleetIds?: string[];

  @ApiPropertyOptional({
    description: 'For a SELECTED audience: the chosen roles.',
    enum: FleetScopeRole,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(FleetScopeRole, { each: true })
  readonly audienceRoles?: FleetScopeRole[];

  @ApiPropertyOptional({
    description:
      'The IANA timezone its clock follows. The Community’s own by default.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  readonly timezone?: string;

  @ApiProperty({ enum: EventRecurrence })
  @IsEnum(EventRecurrence)
  readonly recurrence: EventRecurrence;

  @ApiProperty({ description: 'Its first day, YYYY-MM-DD.' })
  @Matches(DATE_PATTERN, { message: 'startDate must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  readonly startDate: string;

  @ApiProperty({ description: 'Its start, HH:mm, on its own clock.' })
  @Matches(TIME_PATTERN, { message: 'startTime must be HH:mm' })
  readonly startTime: string;

  @ApiPropertyOptional({ description: 'Every how many weeks or months.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  readonly interval?: number;

  @ApiPropertyOptional({
    description: 'For a weekly event: ISO weekdays, 1 Monday to 7 Sunday.',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  readonly weekdays?: number[];

  @ApiPropertyOptional({ description: 'For monthly on a day: 1 to 31.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  readonly monthDay?: number;

  @ApiPropertyOptional({
    description: 'For monthly on a weekday: 1 to 4, or -1 for the last.',
  })
  @IsOptional()
  @IsIn([1, 2, 3, 4, -1])
  readonly monthWeek?: number;

  @ApiPropertyOptional({ description: 'For monthly on a weekday: 1 to 7.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  readonly monthWeekday?: number;

  @ApiPropertyOptional({ description: 'Its last possible day, YYYY-MM-DD.' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'endsOn must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  readonly endsOn?: string;

  @ApiPropertyOptional({ description: 'How many times at most, 1 to 500.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  readonly occurrenceLimit?: number;

  @ApiProperty({ description: 'How long each lasts, 5 to 1440 minutes.' })
  @IsInt()
  @Min(5)
  @Max(1440)
  readonly durationMinutes: number;

  @ApiPropertyOptional({
    description: 'Places for Going, 1 to 1000. No limit when left out.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  readonly capacity?: number | null;
}

/** Where one occurrence moves to, on the event's clock. */
export class MoveOccurrenceDto {
  @ApiProperty({ description: 'Its new day, YYYY-MM-DD.' })
  @Matches(DATE_PATTERN, { message: 'date must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  readonly date: string;

  @ApiProperty({ description: 'Its new start, HH:mm.' })
  @Matches(TIME_PATTERN, { message: 'time must be HH:mm' })
  readonly time: string;
}

/** An answer to an occurrence. */
export class AnswerOccurrenceDto {
  @ApiProperty({ enum: RsvpResponse })
  @IsEnum(RsvpResponse)
  readonly response: RsvpResponse;

  @ApiPropertyOptional({
    description: 'One of the answerer’s own Characters.',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  readonly characterId?: string | null;
}

/**
 * What a manager records happened, for one person. The Character is the
 * one they answered with, if any: a manager never picks another person's.
 */
export class RecordAttendanceDto {
  @ApiProperty() @IsUUID() readonly userId: string;

  @ApiProperty() @IsBoolean() readonly attended: boolean;
}

/** How long before each occurrence to be reminded. */
export class SubscribeRemindersDto {
  @ApiProperty({ type: [Number], description: 'Any of 15, 60 and 1440.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(REMINDER_LEADS, { each: true })
  readonly leadMinutes: number[];
}

/** Which stretch of a scope's calendar to read. */
export class ScopeEventCalendarQueryDto {
  @ApiPropertyOptional({ description: 'From, an ISO instant. Now by default.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  readonly from?: string;

  @ApiPropertyOptional({
    description: 'To, an ISO instant. 31 days on by default; at most 93.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  readonly to?: string;
}

/** How many answered each way. */
export class OccurrenceCountsDto {
  @ApiProperty({ description: 'Going, with a place.' }) going: number;

  @ApiProperty() maybe: number;

  @ApiProperty({ description: 'Going, waiting for a place.' })
  waitlisted: number;

  @ApiProperty({
    description: 'Can’t go. For managers; null for anybody else.',
    nullable: true,
    type: Number,
  })
  notGoing: number | null;
}

/** The reader's own answer. */
export class MyAnswerDto {
  @ApiProperty({ enum: RsvpResponse }) response: RsvpResponse;

  @ApiProperty({ nullable: true, type: String }) characterId: string | null;

  @ApiProperty({
    description: 'Their place on the waitlist, from 1, or null.',
    nullable: true,
    type: Number,
  })
  waitlistPosition: number | null;
}

/** An event, as a calendar shows it. */
export class ScopeEventSummaryDto {
  @ApiProperty() id: string;

  @ApiProperty() title: string;

  @ApiProperty({ enum: ScopeEventAudience }) audience: ScopeEventAudience;

  @ApiProperty() timezone: string;

  @ApiProperty({ nullable: true, type: Number }) capacity: number | null;

  @ApiProperty({ nullable: true, type: String }) externalUrl: string | null;

  @ApiProperty({ enum: ScopeEventStatus }) status: ScopeEventStatus;

  @ApiProperty({ enum: EventRecurrence }) recurrence: EventRecurrence;
}

/** One occurrence, as a calendar shows it. */
export class OccurrenceSummaryDto {
  @ApiProperty() id: string;

  @ApiProperty({ description: 'The day its rule names.' }) key: string;

  @ApiProperty({ description: 'On the event’s clock, YYYY-MM-DDTHH:mm.' })
  localStart: string;

  @ApiProperty() startsAt: Date;

  @ApiProperty() endsAt: Date;

  @ApiProperty({ enum: OccurrenceAdjustment })
  adjustment: OccurrenceAdjustment;

  @ApiProperty({ enum: OccurrenceStatus }) status: OccurrenceStatus;

  @ApiProperty({
    description: 'When it was first due, once moved.',
    nullable: true,
    type: Date,
  })
  movedFromStartsAt: Date | null;

  @ApiProperty({ type: OccurrenceCountsDto }) counts: OccurrenceCountsDto;

  @ApiProperty({ nullable: true, type: MyAnswerDto })
  mine: MyAnswerDto | null;
}

/** One occurrence in a scope's calendar, with its event. */
export class CalendarEntryDto {
  @ApiProperty({ type: ScopeEventSummaryDto }) event: ScopeEventSummaryDto;

  @ApiProperty({ type: OccurrenceSummaryDto })
  occurrence: OccurrenceSummaryDto;
}

/** A stretch of a scope's calendar. */
export class ScopeEventCalendarDto {
  @ApiProperty() from: Date;

  @ApiProperty() to: Date;

  @ApiProperty({ type: [CalendarEntryDto] }) entries: CalendarEntryDto[];

  @ApiProperty({ description: 'Whether the reader holds events.manage.' })
  mayManage: boolean;

  @ApiProperty({ description: 'Whether the scope is open.' }) isOpen: boolean;
}

/** An event in full, with its rule and what lies ahead. */
export class ScopeEventDetailDto extends ScopeEventSummaryDto {
  @ApiProperty() description: string;

  @ApiProperty() startDate: string;

  @ApiProperty() startTime: string;

  @ApiProperty() interval: number;

  @ApiProperty({ type: [Number] }) weekdays: number[];

  @ApiProperty({ nullable: true, type: Number }) monthDay: number | null;

  @ApiProperty({ nullable: true, type: Number }) monthWeek: number | null;

  @ApiProperty({ nullable: true, type: Number }) monthWeekday: number | null;

  @ApiProperty({ nullable: true, type: String }) endsOn: string | null;

  @ApiProperty({ nullable: true, type: Number })
  occurrenceLimit: number | null;

  @ApiProperty() durationMinutes: number;

  @ApiProperty({
    description: 'The chosen Fleets, for managers. Empty for anybody else.',
    type: [String],
  })
  audienceFleetIds: string[];

  @ApiProperty({
    description: 'The chosen roles, for managers. Empty for anybody else.',
    enum: FleetScopeRole,
    isArray: true,
  })
  audienceRoles: FleetScopeRole[];

  @ApiProperty({
    description: 'Up to the next ten occurrences, cancelled ones included.',
    type: [OccurrenceSummaryDto],
  })
  upcoming: OccurrenceSummaryDto[];

  @ApiProperty({
    description: 'How long before each occurrence the reader is reminded.',
    type: [Number],
  })
  myReminders: number[];

  @ApiProperty() mayManage: boolean;

  @ApiProperty({ description: 'Whether the reader may answer it.' })
  mayAnswer: boolean;

  @ApiProperty() isOpen: boolean;
}

/** One person on an occurrence's list. */
export class OccurrencePersonDto {
  @ApiProperty() userId: string;

  @ApiProperty({ nullable: true, type: String }) username: string | null;

  @ApiProperty({ nullable: true, type: String }) characterName: string | null;

  @ApiProperty({ enum: RsvpResponse }) response: RsvpResponse;

  @ApiProperty() waitlisted: boolean;
}

/** One person's attendance. */
export class AttendanceDto {
  @ApiProperty() userId: string;

  @ApiProperty({ nullable: true, type: String }) username: string | null;

  @ApiProperty() attended: boolean;

  @ApiProperty({ nullable: true, type: String }) characterName: string | null;

  @ApiProperty() recordedAt: Date;
}

/** Somebody a manager may record at an occurrence. */
export class AttendanceCandidateDto {
  @ApiProperty() userId: string;

  @ApiProperty({ nullable: true, type: String }) username: string | null;

  @ApiProperty({
    description: 'How they answered, or null for a member who did not.',
    enum: RsvpResponse,
    nullable: true,
  })
  response: RsvpResponse | null;
}

/** What a manager records attendance from. */
export class AttendanceSheetDto {
  @ApiProperty({ type: [AttendanceDto] }) records: AttendanceDto[];

  @ApiProperty({
    description:
      'Everybody who answered, then the scope’s members who did not, by username.',
    type: [AttendanceCandidateDto],
  })
  candidates: AttendanceCandidateDto[];
}

/** One occurrence in full. */
export class OccurrenceDetailDto {
  @ApiProperty({ type: ScopeEventSummaryDto }) event: ScopeEventSummaryDto;

  @ApiProperty({ type: OccurrenceSummaryDto })
  occurrence: OccurrenceSummaryDto;

  @ApiProperty({
    description:
      'Who answered, in answer and waiting order. For the scope’s members and managers; empty for anybody else. Can’t go only for managers.',
    type: [OccurrencePersonDto],
  })
  people: OccurrencePersonDto[];

  @ApiProperty({
    description: 'The reader’s own recorded attendance, or null.',
    nullable: true,
    type: AttendanceDto,
  })
  myAttendance: AttendanceDto | null;

  @ApiProperty() mayAnswer: boolean;

  @ApiProperty() mayManage: boolean;
}

/** An occurrence as it would be placed, before saving. */
export class PreviewOccurrenceDto {
  @ApiProperty() key: string;

  @ApiProperty() localStart: string;

  @ApiProperty() startsAt: Date;

  @ApiProperty() endsAt: Date;

  @ApiProperty({ enum: OccurrenceAdjustment })
  adjustment: OccurrenceAdjustment;
}

/** What a rule comes to over the next twelve months. */
export class EventPreviewDto {
  @ApiProperty() timezone: string;

  @ApiProperty({ type: [PreviewOccurrenceDto] })
  occurrences: PreviewOccurrenceDto[];

  @ApiProperty({
    description: 'Months a monthly event skips, YYYY-MM.',
    type: [String],
  })
  skippedMonths: string[];
}

/** The scope an occurrence on somebody's own list belongs to. */
export class UpcomingScopeDto {
  @ApiProperty({ enum: FleetScopeKind }) kind: FleetScopeKind;

  @ApiProperty() name: string;

  @ApiProperty({ description: 'Its page on the site.' }) path: string;
}

/** One occurrence on somebody's own list, with its event and scope. */
export class UpcomingEntryDto {
  @ApiProperty({ type: ScopeEventSummaryDto }) event: ScopeEventSummaryDto;

  @ApiProperty({ type: OccurrenceSummaryDto })
  occurrence: OccurrenceSummaryDto;

  @ApiProperty({ type: UpcomingScopeDto }) scope: UpcomingScopeDto;
}

/** Somebody's own next thirty days. */
export class UpcomingEventsDto {
  @ApiProperty({ type: [UpcomingEntryDto] }) entries: UpcomingEntryDto[];
}

/** One change in an event's log. */
export class ScopeEventActionDto {
  @ApiProperty() id: string;

  @ApiProperty({ enum: ScopeEventActionKind }) action: ScopeEventActionKind;

  @ApiProperty({ nullable: true, type: String }) occurrenceId: string | null;

  @ApiProperty({ nullable: true, type: String }) actorName: string | null;

  @ApiProperty({ nullable: true, type: String }) subjectName: string | null;

  @ApiProperty({ nullable: true }) detail: Record<string, unknown> | null;

  @ApiProperty() createdAt: Date;
}
