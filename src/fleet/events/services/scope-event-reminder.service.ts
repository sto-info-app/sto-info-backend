import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager } from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { NotificationOutboxEntity } from 'src/notification/outbox/notification-outbox.entity';
import {
  NotificationOutboxHandler,
  NotificationOutboxRegistry,
  OutboxMessage,
} from 'src/notification/outbox/notification-outbox.registry';

import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { GovernanceScope } from '../../governance/utilities/governance-scope.utility';
import { toPlatformSegment } from '../../utilities/platform-segment.utility';
import { SubscribeRemindersDto } from '../dto/scope-event.dto';
import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventReminderEntity } from '../entities/scope-event-reminder.entity';
import { ScopeEventRsvpEntity } from '../entities/scope-event-rsvp.entity';
import { ScopeEventEntity } from '../entities/scope-event.entity';
import {
  OccurrenceStatus,
  RsvpResponse,
  ScopeEventStatus,
} from '../enums/scope-event.enums';
import {
  assertEventActive,
  findEventInScope,
} from '../utilities/event-scope.utility';
import { ScopeEventAccessService } from './scope-event-access.service';

/** How each lead reads in a title. */
const LEAD_PHRASES: Readonly<Record<number, string>> = {
  15: 'in 15 minutes',
  60: 'in an hour',
  1440: 'tomorrow',
};

/** The kinds of notice this writes. */
const EVENT_KINDS = [
  NotificationOutboxKind.EVENT_REMINDER,
  NotificationOutboxKind.EVENT_CANCELLED,
  NotificationOutboxKind.EVENT_MOVED,
  NotificationOutboxKind.EVENT_PROMOTED,
] as const;

/**
 * Event reminders, and what every event notice says (FC-028).
 *
 * Steve's decisions of 28 September 2026: somebody subscribes to an event —
 * a one-off or a whole series — to be reminded fifteen minutes, an hour or a
 * day before each occurrence, and is told when an occurrence they would be
 * reminded of is cancelled or moved. Somebody given a place off the
 * waitlist is told too. All of it in-app, under the event reminder
 * category, which they can switch off.
 *
 * The notices go through the notification outbox (FC-029). This is its
 * handler for event notices: every minute it queues the reminders that have
 * come due, and before each notice is sent it asks again whether it is still
 * wanted — whether the person may still see the event and, for a reminder,
 * whether the occurrence is still going ahead and not yet started — and
 * writes it from the event as it now stands.
 */
@Injectable()
export class ScopeEventReminderService
  implements NotificationOutboxHandler, OnModuleInit
{
  readonly kinds = EVENT_KINDS;

  /**
   * Creates an instance of ScopeEventReminderService.
   *
   * @param _dataSource - The database.
   * @param _access - Says who may see an event.
   * @param _registry - Which handler writes which notice.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _access: ScopeEventAccessService,
    private readonly _registry: NotificationOutboxRegistry,
  ) {}

  /**
   * Registers this as the outbox's handler for event notices.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Asks to be reminded of an event, or changes how long before.
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param userId - The person.
   * @param dto - How long before each occurrence.
   * @returns The leads now in force.
   * @throws NotFoundException when there is no such event they may see.
   * @throws ConflictException when it was cancelled.
   */
  async subscribe(
    scope: GovernanceScope,
    eventId: string,
    userId: string,
    dto: SubscribeRemindersDto,
  ): Promise<number[]> {
    const viewer = await this._access.viewerAt(scope, userId);
    const manager = this._dataSource.manager;
    const event = await findEventInScope(manager, scope, eventId);

    if (!(await this._access.canSee(event, viewer))) {
      throw new NotFoundException('Not found');
    }

    assertEventActive(event);

    const leadMinutes = [...new Set(dto.leadMinutes)].sort((a, b) => a - b);
    const reminder =
      (await manager.findOne(ScopeEventReminderEntity, {
        where: { eventId, userId },
      })) ?? manager.create(ScopeEventReminderEntity, { eventId, userId });

    reminder.leadMinutes = leadMinutes;
    await manager.save(ScopeEventReminderEntity, reminder);

    return leadMinutes;
  }

  /**
   * Stops being reminded of an event.
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param userId - The person.
   * @throws NotFoundException when there is no such event, or they were not
   *   being reminded of it.
   */
  async unsubscribe(
    scope: GovernanceScope,
    eventId: string,
    userId: string,
  ): Promise<void> {
    await this._access.viewerAt(scope, userId);

    const manager = this._dataSource.manager;

    await findEventInScope(manager, scope, eventId);

    const removed = await manager.delete(ScopeEventReminderEntity, {
      eventId,
      userId,
    });

    if (removed.affected === 0) {
      throw new NotFoundException('You are not being reminded of it.');
    }
  }

  /**
   * Queues, in one statement, every reminder whose moment has come for an
   * occurrence that has not started, of a running event, for each lead of
   * each subscription made before that moment.
   *
   * The keys are {@link noticeKeyOf}'s, so a reminder already queued is not
   * queued again, and one for an occurrence since moved is.
   *
   * @param now - The moment of the run.
   */
  async queueDue(now: Date): Promise<void> {
    await this._dataSource.query(
      `INSERT INTO "sto_info_app"."notification_outbox" ("userId", "kind", "subjectId", "detail", "dedupeKey")
       SELECT r."userId", 'EVENT_REMINDER', o."id", jsonb_build_object('leadMinutes', lead),
              'EVENT_REMINDER:' || o."id" || ':' || r."userId" || ':' || lead || ':' || floor(extract(epoch FROM o."startsAt"))::bigint
         FROM "sto_info_app"."scope_event_occurrence" o
         JOIN "sto_info_app"."scope_event" e ON e."id" = o."eventId" AND e."status" = 'ACTIVE'
         JOIN "sto_info_app"."scope_event_reminder" r ON r."eventId" = o."eventId"
         CROSS JOIN LATERAL unnest(r."leadMinutes") AS lead
        WHERE o."status" = 'SCHEDULED'
          AND o."startsAt" > $1
          AND o."startsAt" - make_interval(mins => lead) <= $1
          AND r."updatedAt" <= o."startsAt" - make_interval(mins => lead)
       ON CONFLICT ("dedupeKey") DO NOTHING`,
      [now],
    );
  }

  /**
   * Writes an event notice, if it is still wanted.
   *
   * @param notice - The notice.
   * @param manager - The delivery's transaction.
   * @param now - The moment of the run.
   * @returns The message, or null to set it aside.
   */
  async compose(
    notice: NotificationOutboxEntity,
    manager: EntityManager,
    now: Date,
  ): Promise<OutboxMessage | null> {
    const occurrence = await manager.findOne(ScopeEventOccurrenceEntity, {
      where: { id: notice.subjectId },
    });
    const event =
      occurrence === null
        ? null
        : await manager.findOne(ScopeEventEntity, {
            where: { id: occurrence.eventId },
          });

    if (
      occurrence === null ||
      event === null ||
      !(await this.stillShown(event, notice.userId)) ||
      !(await this.stillTrue(manager, notice, event, occurrence, now))
    ) {
      return null;
    }

    const place = await this.placeOf(manager, event);

    return {
      ...this.messageOf(notice, event, occurrence, place.name),
      linkUrl: place.link,
    };
  }

  /**
   * Reports whether the person may still see the event.
   *
   * @param event - The event.
   * @param userId - The person.
   * @returns True when they may.
   */
  private async stillShown(
    event: ScopeEventEntity,
    userId: string,
  ): Promise<boolean> {
    const viewer = await this._access.viewerOf(event, userId);

    return viewer !== null && this._access.canSee(event, viewer);
  }

  /**
   * Reports whether what a notice says is still so.
   *
   * @param manager - The transaction.
   * @param notice - The notice.
   * @param event - The event.
   * @param occurrence - The occurrence.
   * @param now - The moment of the run.
   * @returns True when it is still worth sending.
   */
  private async stillTrue(
    manager: EntityManager,
    notice: NotificationOutboxEntity,
    event: ScopeEventEntity,
    occurrence: ScopeEventOccurrenceEntity,
    now: Date,
  ): Promise<boolean> {
    const ahead =
      event.status === ScopeEventStatus.ACTIVE &&
      occurrence.status === OccurrenceStatus.SCHEDULED &&
      occurrence.startsAt > now;

    switch (notice.kind) {
      case NotificationOutboxKind.EVENT_REMINDER: {
        const reminder = await manager.findOne(ScopeEventReminderEntity, {
          where: { eventId: event.id, userId: notice.userId },
        });

        return (
          ahead &&
          reminder !== null &&
          reminder.leadMinutes.includes(leadOf(notice))
        );
      }
      case NotificationOutboxKind.EVENT_PROMOTED: {
        const rsvp = await manager.findOne(ScopeEventRsvpEntity, {
          where: { occurrenceId: occurrence.id, userId: notice.userId },
        });

        return (
          ahead &&
          rsvp?.response === RsvpResponse.GOING &&
          rsvp.waitlistedAt === null
        );
      }
      case NotificationOutboxKind.EVENT_MOVED:
        return ahead;
      default:
        return true;
    }
  }

  /**
   * Writes what a notice says.
   *
   * The time is given on the event's own clock, with its timezone named,
   * which is what the organiser chose and what the reader can convert.
   *
   * @param notice - The notice.
   * @param event - The event.
   * @param occurrence - The occurrence.
   * @param scopeName - Whose event it is.
   * @returns The message, without its link.
   */
  private messageOf(
    notice: NotificationOutboxEntity,
    event: ScopeEventEntity,
    occurrence: ScopeEventOccurrenceEntity,
    scopeName: string,
  ): Omit<OutboxMessage, 'linkUrl'> {
    const when = whenOf(occurrence.startsAt, event.timezone);
    const what = `${event.title} (${scopeName})`;

    switch (notice.kind) {
      case NotificationOutboxKind.EVENT_REMINDER:
        return {
          title: `${event.title} starts ${LEAD_PHRASES[leadOf(notice)]}`,
          body: `${what} starts ${when}.`,
          severity: NotificationSeverity.INFO,
        };
      case NotificationOutboxKind.EVENT_CANCELLED:
        return {
          title: `${event.title} is cancelled`,
          body: `${what}, due ${when}, has been cancelled.`,
          severity: NotificationSeverity.WARNING,
        };
      case NotificationOutboxKind.EVENT_MOVED:
        return {
          title: `${event.title} has moved`,
          body: `${what} now starts ${when}.`,
          severity: NotificationSeverity.INFO,
        };
      default:
        return {
          title: `You have a place at ${event.title}`,
          body: `A place came free at ${what}, ${when}, and it is yours.`,
          severity: NotificationSeverity.SUCCESS,
        };
    }
  }

  /**
   * Names whose event it is, and where its page is.
   *
   * The page is the event's own, below its scope: FC-030's address for it.
   *
   * @param manager - The transaction.
   * @param event - The event.
   * @returns The scope's name, and the link, or null without a site address.
   */
  private async placeOf(
    manager: EntityManager,
    event: ScopeEventEntity,
  ): Promise<{ name: string; link: string | null }> {
    const community = (await manager.findOne(FleetCommunityEntity, {
      where: { id: event.communityId },
    })) as FleetCommunityEntity;
    let name = community.name;
    let path = `/fleets/communities/${community.slug}`;

    if (event.fleetId !== null) {
      const fleet = (await manager.findOne(StoFleetEntity, {
        where: { id: event.fleetId },
        relations: { platform: true },
      })) as StoFleetEntity;

      name = fleet.exactGameName;
      path += `/fleets/${toPlatformSegment(fleet.platform.name)}/${fleet.slug}`;
    } else if (event.armadaId !== null) {
      const armada = (await manager.findOne(StoArmadaEntity, {
        where: { id: event.armadaId },
        relations: { platform: true },
      })) as StoArmadaEntity;

      name = armada.exactGameName;
      path += `/armadas/${toPlatformSegment(armada.platform.name)}/${armada.slug}`;
    }

    const site = process.env.APP_FRONTEND_URL;

    return {
      name,
      link: site ? `${site}${path}/events/${event.id}` : null,
    };
  }
}

/**
 * A reminder's lead, in minutes.
 *
 * @param notice - The reminder.
 * @returns Its lead.
 */
function leadOf(notice: NotificationOutboxEntity): number {
  return (notice.detail as { leadMinutes: number }).leadMinutes;
}

/**
 * Writes an instant on an event's clock, naming the timezone.
 *
 * @param instant - The instant.
 * @param timezone - The event's timezone.
 * @returns Such as "at 20:00 on Fri 2 Oct 2026 (Europe/London)".
 */
function whenOf(instant: Date, timezone: string): string {
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(instant);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);

  return `at ${time} on ${day.replace(',', '')} (${timezone})`;
}
