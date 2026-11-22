import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { OptionalUserId, UserId } from 'src/auth/user-id.decorator';

import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import {
  RequiresScopeCapability,
  ScopeSource,
} from '../authorisation/requires-scope-capability.decorator';
import { ScopeCapabilityGuard } from '../authorisation/scope-capability.guard';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import {
  armadaScope,
  communityScope,
  fleetScope,
  GovernanceScope,
} from '../governance/utilities/governance-scope.utility';
import {
  AnswerOccurrenceDto,
  AttendanceSheetDto,
  EventPreviewDto,
  MoveOccurrenceDto,
  MyAnswerDto,
  OccurrenceDetailDto,
  RecordAttendanceDto,
  ScopeEventActionDto,
  ScopeEventCalendarDto,
  ScopeEventCalendarQueryDto,
  ScopeEventDefinitionDto,
  ScopeEventDetailDto,
  SubscribeRemindersDto,
  UpcomingEventsDto,
} from './dto/scope-event.dto';
import { ScopeEventAttendanceService } from './services/scope-event-attendance.service';
import { ScopeEventReadService } from './services/scope-event-read.service';
import { ScopeEventReminderService } from './services/scope-event-reminder.service';
import { ScopeEventRsvpService } from './services/scope-event-rsvp.service';
import { ScopeEventService } from './services/scope-event.service';

/** Where one kind of scope's events are addressed. */
interface ScopeEventRoutes {
  /** The kind of scope. */
  readonly kind: FleetScopeKind;
  /** The route prefix, ending in `/events`. */
  readonly path: string;
  /** The path parameter naming the scope itself. */
  readonly param: string;
  /** Names the scope from the Community and the scope's own ID. */
  readonly scopeOf: (communityId: string, id: string) => GovernanceScope;
}

const NOT_OPEN =
  'The scope is closed, the event or occurrence cancelled, or it has started.';

const NOT_HERE = 'No such event or occurrence here that the reader may see.';

/**
 * Builds the event routes of one kind of scope (FC-028).
 *
 * A Community's, a Fleet's and an Armada's events are the same routes under
 * three prefixes, as their news is, so a rule cannot be written into two and
 * missed in the third. Reading is for whoever may see each event, signed in
 * or not. Running events needs `events.manage` at the scope; answering
 * and reminders need an account, and the service decides who may answer.
 *
 * @param routes - Where this kind of scope's events are addressed.
 * @returns The controller class.
 */
function scopeEventController(routes: ScopeEventRoutes) {
  const source: ScopeSource =
    routes.kind === FleetScopeKind.COMMUNITY
      ? { kind: routes.kind, param: routes.param }
      : {
          kind: routes.kind,
          param: routes.param,
          communityParam: 'communityId',
        };

  @ApiTags('Fleet events')
  @ApiBearerAuth()
  @Controller(routes.path)
  class ScopeEventController {
    /**
     * Creates an instance of the controller.
     *
     * @param _featureService - Reports whether the Fleet feature is on.
     * @param _events - Runs the scope's events.
     * @param _reads - Reads them.
     * @param _rsvps - Takes answers.
     * @param _attendance - Records who came.
     * @param _reminders - Takes reminder subscriptions.
     */
    constructor(
      readonly _featureService: FleetFeatureService,
      readonly _events: ScopeEventService,
      readonly _reads: ScopeEventReadService,
      readonly _rsvps: ScopeEventRsvpService,
      readonly _attendance: ScopeEventAttendanceService,
      readonly _reminders: ScopeEventReminderService,
    ) {}

    /**
     * Reads a stretch of the scope's calendar.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param userId - The reader, or null when signed out.
     * @param query - From and to.
     * @returns The occurrences, earliest first.
     */
    @Get()
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'Read a scope’s calendar' })
    @ApiOkResponse({ type: ScopeEventCalendarDto })
    @ApiBadRequestResponse({ description: 'A stretch backwards or too long.' })
    async calendar(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @OptionalUserId() userId: string | null,
      @Query() query: ScopeEventCalendarQueryDto,
    ): Promise<ScopeEventCalendarDto> {
      await this._featureService.assertEnabled();

      return this._reads.calendar(
        routes.scopeOf(communityId, id),
        userId,
        query,
      );
    }

    /**
     * Shows what an event's rule would come to, without saving it.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param dto - The event as it would be saved.
     * @param userId - The organiser.
     * @returns The occurrences ahead, and how each was placed.
     */
    @Post('preview')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.EVENTS_MANAGE, source)
    @ApiOperation({ summary: 'Preview an event’s occurrences' })
    @ApiOkResponse({ type: EventPreviewDto })
    @ApiBadRequestResponse({ description: 'An incomplete rule.' })
    async preview(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Body() dto: ScopeEventDefinitionDto,
      @UserId() userId: string,
    ): Promise<EventPreviewDto> {
      await this._featureService.assertEnabled();

      return this._events.preview(routes.scopeOf(communityId, id), dto, userId);
    }

    /**
     * Creates an event.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param dto - The event.
     * @param userId - The organiser.
     * @returns The event.
     */
    @Post()
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.EVENTS_MANAGE, source)
    @ApiOperation({ summary: 'Create an event' })
    @ApiCreatedResponse({ type: ScopeEventDetailDto })
    @ApiBadRequestResponse({ description: 'An incomplete rule.' })
    @ApiConflictResponse({ description: NOT_OPEN })
    async create(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Body() dto: ScopeEventDefinitionDto,
      @UserId() userId: string,
    ): Promise<ScopeEventDetailDto> {
      await this._featureService.assertEnabled();

      const scope = routes.scopeOf(communityId, id);
      const event = await this._events.create(scope, dto, userId);

      return this._reads.detail(scope, event.id, userId);
    }

    /**
     * Reads an event, with what lies ahead of it.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param userId - The reader, or null when signed out.
     * @returns The event.
     */
    @Get(':eventId')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'Read an event' })
    @ApiOkResponse({ type: ScopeEventDetailDto })
    @ApiNotFoundResponse({ description: NOT_HERE })
    async detail(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @OptionalUserId() userId: string | null,
    ): Promise<ScopeEventDetailDto> {
      await this._featureService.assertEnabled();

      return this._reads.detail(
        routes.scopeOf(communityId, id),
        eventId,
        userId,
      );
    }

    /**
     * Changes an event from now on.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param dto - The event as it should now be.
     * @param userId - The organiser.
     * @returns The event.
     */
    @Put(':eventId')
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.EVENTS_MANAGE, source)
    @ApiOperation({ summary: 'Change an event from now on' })
    @ApiOkResponse({ type: ScopeEventDetailDto })
    @ApiBadRequestResponse({ description: 'An incomplete rule.' })
    @ApiNotFoundResponse({ description: NOT_HERE })
    @ApiConflictResponse({ description: NOT_OPEN })
    async update(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @Body() dto: ScopeEventDefinitionDto,
      @UserId() userId: string,
    ): Promise<ScopeEventDetailDto> {
      await this._featureService.assertEnabled();

      const scope = routes.scopeOf(communityId, id);

      await this._events.update(scope, eventId, dto, userId);

      return this._reads.detail(scope, eventId, userId);
    }

    /**
     * Cancels an event: everything of it still to come.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param userId - The organiser.
     */
    @Post(':eventId/cancel')
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.EVENTS_MANAGE, source)
    @ApiOperation({ summary: 'Cancel an event' })
    @ApiNoContentResponse({ description: 'Cancelled.' })
    @ApiNotFoundResponse({ description: NOT_HERE })
    @ApiConflictResponse({ description: NOT_OPEN })
    async cancel(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @UserId() userId: string,
    ): Promise<void> {
      await this._featureService.assertEnabled();
      await this._events.cancel(
        routes.scopeOf(communityId, id),
        eventId,
        userId,
      );
    }

    /**
     * Reads an event's change log.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param userId - The manager.
     * @returns Each change, newest first.
     */
    @Get(':eventId/history')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Read an event’s change log' })
    @ApiOkResponse({ type: [ScopeEventActionDto] })
    @ApiForbiddenResponse({ description: 'Not one of its event managers.' })
    async history(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @UserId() userId: string,
    ): Promise<ScopeEventActionDto[]> {
      await this._featureService.assertEnabled();

      return this._reads.history(
        routes.scopeOf(communityId, id),
        eventId,
        userId,
      );
    }

    /**
     * Asks to be reminded of an event, or changes how long before.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param dto - How long before each occurrence.
     * @param userId - The person.
     * @returns The leads now in force.
     */
    @Put(':eventId/reminders')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Be reminded of an event' })
    @ApiOkResponse({ type: [Number] })
    @ApiNotFoundResponse({ description: NOT_HERE })
    @ApiConflictResponse({ description: 'The event was cancelled.' })
    async subscribe(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @Body() dto: SubscribeRemindersDto,
      @UserId() userId: string,
    ): Promise<number[]> {
      await this._featureService.assertEnabled();

      return this._reminders.subscribe(
        routes.scopeOf(communityId, id),
        eventId,
        userId,
        dto,
      );
    }

    /**
     * Stops being reminded of an event.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param userId - The person.
     */
    @Delete(':eventId/reminders')
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Stop being reminded of an event' })
    @ApiNoContentResponse({ description: 'Stopped.' })
    @ApiNotFoundResponse({ description: 'Not being reminded of it.' })
    async unsubscribe(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @UserId() userId: string,
    ): Promise<void> {
      await this._featureService.assertEnabled();
      await this._reminders.unsubscribe(
        routes.scopeOf(communityId, id),
        eventId,
        userId,
      );
    }

    /**
     * Reads one occurrence, with its counts and who answered.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param occurrenceId - The occurrence.
     * @param userId - The reader, or null when signed out.
     * @returns The occurrence.
     */
    @Get(':eventId/occurrences/:occurrenceId')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'Read an occurrence' })
    @ApiOkResponse({ type: OccurrenceDetailDto })
    @ApiNotFoundResponse({ description: NOT_HERE })
    async occurrence(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @Param('occurrenceId', ParseUUIDPipe) occurrenceId: string,
      @OptionalUserId() userId: string | null,
    ): Promise<OccurrenceDetailDto> {
      await this._featureService.assertEnabled();

      return this._reads.occurrence(
        routes.scopeOf(communityId, id),
        eventId,
        occurrenceId,
        userId,
      );
    }

    /**
     * Cancels one occurrence.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param occurrenceId - The occurrence.
     * @param userId - The organiser.
     */
    @Post(':eventId/occurrences/:occurrenceId/cancel')
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.EVENTS_MANAGE, source)
    @ApiOperation({ summary: 'Cancel one occurrence' })
    @ApiNoContentResponse({ description: 'Cancelled.' })
    @ApiNotFoundResponse({ description: NOT_HERE })
    @ApiConflictResponse({ description: NOT_OPEN })
    async cancelOccurrence(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @Param('occurrenceId', ParseUUIDPipe) occurrenceId: string,
      @UserId() userId: string,
    ): Promise<void> {
      await this._featureService.assertEnabled();
      await this._events.cancelOccurrence(
        routes.scopeOf(communityId, id),
        eventId,
        occurrenceId,
        userId,
      );
    }

    /**
     * Moves one occurrence.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param occurrenceId - The occurrence.
     * @param dto - Where it moves to.
     * @param userId - The organiser.
     */
    @Post(':eventId/occurrences/:occurrenceId/move')
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.EVENTS_MANAGE, source)
    @ApiOperation({ summary: 'Move one occurrence' })
    @ApiNoContentResponse({ description: 'Moved.' })
    @ApiBadRequestResponse({ description: 'A time that has passed.' })
    @ApiNotFoundResponse({ description: NOT_HERE })
    @ApiConflictResponse({ description: NOT_OPEN })
    async moveOccurrence(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @Param('occurrenceId', ParseUUIDPipe) occurrenceId: string,
      @Body() dto: MoveOccurrenceDto,
      @UserId() userId: string,
    ): Promise<void> {
      await this._featureService.assertEnabled();
      await this._events.moveOccurrence(
        routes.scopeOf(communityId, id),
        eventId,
        occurrenceId,
        dto,
        userId,
      );
    }

    /**
     * Answers an occurrence, or changes an answer.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param occurrenceId - The occurrence.
     * @param dto - The answer, and a Character of the answerer's own.
     * @param userId - The person answering.
     * @returns Their answer as it now stands.
     */
    @Put(':eventId/occurrences/:occurrenceId/rsvp')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Answer an occurrence' })
    @ApiOkResponse({ type: MyAnswerDto })
    @ApiBadRequestResponse({ description: 'A Character not theirs.' })
    @ApiForbiddenResponse({ description: 'Not one who may answer it.' })
    @ApiNotFoundResponse({ description: NOT_HERE })
    @ApiConflictResponse({ description: NOT_OPEN })
    async answer(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @Param('occurrenceId', ParseUUIDPipe) occurrenceId: string,
      @Body() dto: AnswerOccurrenceDto,
      @UserId() userId: string,
    ): Promise<MyAnswerDto> {
      await this._featureService.assertEnabled();

      return this._rsvps.answer(
        routes.scopeOf(communityId, id),
        eventId,
        occurrenceId,
        userId,
        dto,
      );
    }

    /**
     * Takes an answer back.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param occurrenceId - The occurrence.
     * @param userId - The person.
     */
    @Delete(':eventId/occurrences/:occurrenceId/rsvp')
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Take an answer back' })
    @ApiNoContentResponse({ description: 'Taken back.' })
    @ApiNotFoundResponse({ description: 'No answer, or nothing here.' })
    @ApiConflictResponse({ description: NOT_OPEN })
    async withdraw(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @Param('occurrenceId', ParseUUIDPipe) occurrenceId: string,
      @UserId() userId: string,
    ): Promise<void> {
      await this._featureService.assertEnabled();
      await this._rsvps.withdraw(
        routes.scopeOf(communityId, id),
        eventId,
        occurrenceId,
        userId,
      );
    }

    /**
     * Reads who came to an occurrence.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param occurrenceId - The occurrence.
     * @param userId - The manager.
     * @returns Each person recorded, and whom they may still record.
     */
    @Get(':eventId/occurrences/:occurrenceId/attendance')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Read who came to an occurrence' })
    @ApiOkResponse({ type: AttendanceSheetDto })
    @ApiForbiddenResponse({ description: 'Not one of its event managers.' })
    async attendance(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @Param('occurrenceId', ParseUUIDPipe) occurrenceId: string,
      @UserId() userId: string,
    ): Promise<AttendanceSheetDto> {
      await this._featureService.assertEnabled();

      return this._reads.attendance(
        routes.scopeOf(communityId, id),
        eventId,
        occurrenceId,
        userId,
      );
    }

    /**
     * Records whether somebody came.
     *
     * @param communityId - The Community.
     * @param id - The scope's own ID.
     * @param eventId - The event.
     * @param occurrenceId - The occurrence.
     * @param dto - Who, whether they came, and as which Character.
     * @param userId - The manager.
     */
    @Put(':eventId/occurrences/:occurrenceId/attendance')
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(JwtAuthGuard, ScopeCapabilityGuard)
    @RequiresScopeCapability(FLEET_CAPABILITIES.EVENTS_MANAGE, source)
    @ApiOperation({ summary: 'Record whether somebody came' })
    @ApiNoContentResponse({ description: 'Recorded.' })
    @ApiBadRequestResponse({
      description: 'No such person, or not their Character.',
    })
    @ApiNotFoundResponse({ description: NOT_HERE })
    @ApiConflictResponse({ description: 'Cancelled, or not yet started.' })
    async recordAttendance(
      @Param('communityId', ParseUUIDPipe) communityId: string,
      @Param(routes.param, ParseUUIDPipe) id: string,
      @Param('eventId', ParseUUIDPipe) eventId: string,
      @Param('occurrenceId', ParseUUIDPipe) occurrenceId: string,
      @Body() dto: RecordAttendanceDto,
      @UserId() userId: string,
    ): Promise<void> {
      await this._featureService.assertEnabled();
      await this._attendance.record(
        routes.scopeOf(communityId, id),
        eventId,
        occurrenceId,
        dto,
        userId,
      );
    }
  }

  return ScopeEventController;
}

/** A Community's own events, not its Fleets' or Armadas'. */
export class CommunityEventsController extends scopeEventController({
  kind: FleetScopeKind.COMMUNITY,
  path: 'fleet-communities/:communityId/events',
  param: 'communityId',
  scopeOf: communityId => communityScope(communityId),
}) {}

/** A Fleet's events. */
export class FleetEventsController extends scopeEventController({
  kind: FleetScopeKind.FLEET,
  path: 'fleet-communities/:communityId/fleets/:fleetId/events',
  param: 'fleetId',
  scopeOf: fleetScope,
}) {}

/** An Armada's events. */
export class ArmadaEventsController extends scopeEventController({
  kind: FleetScopeKind.ARMADA,
  path: 'fleet-communities/:communityId/armadas/:armadaId/events',
  param: 'armadaId',
  scopeOf: armadaScope,
}) {}

/**
 * Somebody's own upcoming events (FC-030): what they answered, are waiting
 * for, or asked to be reminded of, over the next thirty days.
 */
@ApiTags('Fleet events')
@ApiBearerAuth()
@Controller('fleet-events')
export class PersonalEventsController {
  /**
   * Creates an instance of PersonalEventsController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _reads - Reads events.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _reads: ScopeEventReadService,
  ) {}

  /**
   * Reads the caller's own next thirty days.
   *
   * @param userId - The caller.
   * @returns Each occurrence with its event and scope, soonest first.
   */
  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Read your own upcoming events' })
  @ApiOkResponse({ type: UpcomingEventsDto })
  async mine(@UserId() userId: string): Promise<UpcomingEventsDto> {
    await this._featureService.assertEnabled();

    return this._reads.upcomingFor(userId);
  }
}
