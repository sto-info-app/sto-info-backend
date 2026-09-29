import { Injectable } from '@nestjs/common';

import { EntityManager } from 'typeorm';

import { NewsPostEntity } from 'src/news/entities/news-post.entity';

import { ARMADA_POSITION_NAMES } from '../../armadas/services/armada-notifier.service';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ArmadaPosition } from '../../enums/armada-position.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeEventEntity } from '../../events/entities/scope-event.entity';
import { FleetHoldingTypeEntity } from '../../holdings/entities/fleet-holding-type.entity';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { toPlatformSegment } from '../../utilities/platform-segment.utility';
import { ActivityScopeDto } from '../dto/activity.dto';
import { ActivityEventEntity } from '../entities/activity-event.entity';
import { ActivityType } from '../enums/activity.enums';

/** An item's source, where it has one the reader may see. */
export type ActivitySource =
  { readonly post: NewsPostEntity } | { readonly event: ScopeEventEntity };

/** How each role reads in a sentence. */
const ROLE_NOUNS: Readonly<Record<FleetScopeRole, string>> = {
  [FleetScopeRole.OWNER]: 'the Owner',
  [FleetScopeRole.ADMIN]: 'an Admin',
  [FleetScopeRole.OFFICER]: 'an Officer',
  [FleetScopeRole.MEMBER]: 'a Member',
};

/** Who somebody is when nobody can be named. */
const SOMEBODY = 'Somebody';

/** An item, written. */
export interface WrittenActivity {
  readonly sentence: string;
  readonly path: string | null;
}

/**
 * Writes an activity item as a sentence, from the data as it stands now
 * (FC-029).
 *
 * People are named by username and nothing else; a roster import gives
 * counts, never names. An item whose Fleet, Armada or holding has gone is
 * left out rather than half-written.
 */
@Injectable()
export class ActivitySentenceWriter {
  /**
   * Writes one item.
   *
   * @param manager - The manager to read through.
   * @param row - The item.
   * @param place - Its scope.
   * @param source - Its source, where it has one.
   * @returns The sentence and where it leads, or null to leave it out.
   */
  async write(
    manager: EntityManager,
    row: ActivityEventEntity,
    place: ActivityScopeDto,
    source: ActivitySource | null,
  ): Promise<WrittenActivity | null> {
    const detail = row.detail ?? {};

    switch (row.type) {
      case ActivityType.NEWS_PUBLISHED: {
        const { post } = source as { post: NewsPostEntity };

        return {
          sentence: `“${post.title}” was published.`,
          path: `${place.path}/news/${post.slug}`,
        };
      }
      case ActivityType.EVENT_CREATED:
      case ActivityType.EVENT_CANCELLED:
      case ActivityType.OCCURRENCE_CANCELLED:
      case ActivityType.OCCURRENCE_MOVED:
        return this.eventSentence(
          row,
          place,
          source as { event: ScopeEventEntity },
        );
      case ActivityType.MEMBER_JOINED:
      case ActivityType.MEMBER_LEFT:
      case ActivityType.MEMBER_REMOVED:
      case ActivityType.ROLE_APPOINTED:
      case ActivityType.ROLE_WITHDRAWN:
      case ActivityType.OWNERSHIP_TRANSFERRED:
        return this.personSentence(manager, row, place);
      case ActivityType.ROSTER_IMPORTED:
        return {
          sentence:
            `A roster export was imported: ${Number(detail.members)} members, ` +
            `${Number(detail.joined)} joined and ${Number(detail.left)} left.`,
          path: `${place.path}/history`,
        };
      case ActivityType.HOLDINGS_RECORDED: {
        const holding = await manager.findOne(FleetHoldingTypeEntity, {
          where: { code: String(detail.holdingCode) },
        });

        return holding === null
          ? null
          : {
              sentence: `${holding.name} tiers were recorded.`,
              path: `${place.path}/holdings`,
            };
      }
      case ActivityType.ARMADA_FLEET_PLACED:
      case ActivityType.ARMADA_FLEET_MOVED:
      case ActivityType.ARMADA_FLEET_LEFT:
        return this.armadaSentence(manager, row, place);
      case ActivityType.SCOPE_CLOSED:
        return { sentence: `${place.name} was closed.`, path: place.path };
    }
  }

  /**
   * Writes an item about an event.
   *
   * @param row - The item.
   * @param place - Its scope.
   * @param source - The event.
   * @returns The sentence and the event's page.
   */
  private eventSentence(
    row: ActivityEventEntity,
    place: ActivityScopeDto,
    source: { event: ScopeEventEntity },
  ): WrittenActivity {
    const { event } = source;
    const detail = row.detail ?? {};
    const path = `${place.path}/events/${event.id}`;
    const dayOf = (at: unknown) => dayIn(new Date(String(at)), event.timezone);

    switch (row.type) {
      case ActivityType.EVENT_CREATED:
        return { sentence: `${event.title} was added to the calendar.`, path };
      case ActivityType.EVENT_CANCELLED:
        return { sentence: `${event.title} was cancelled.`, path };
      case ActivityType.OCCURRENCE_CANCELLED:
        return {
          sentence: `${event.title} on ${dayOf(detail.startsAt)} was cancelled.`,
          path,
        };
      default:
        return {
          sentence: `${event.title} on ${dayOf(detail.from)} moved to ${dayOf(detail.to)}.`,
          path,
        };
    }
  }

  /**
   * Writes an item about a person: joining, leaving, a role, ownership.
   *
   * @param manager - The manager to read through.
   * @param row - The item.
   * @param place - Its scope.
   * @returns The sentence and the scope's page.
   */
  private async personSentence(
    manager: EntityManager,
    row: ActivityEventEntity,
    place: ActivityScopeDto,
  ): Promise<WrittenActivity> {
    const names = await usernamesFor(manager, [row.subjectUserId]);
    const who =
      row.subjectUserId === null
        ? SOMEBODY
        : (names.get(row.subjectUserId) ?? SOMEBODY);
    const role = ROLE_NOUNS[(row.detail?.role as FleetScopeRole) ?? 'MEMBER'];
    const sentences: Partial<Record<ActivityType, string>> = {
      [ActivityType.MEMBER_JOINED]: `${who} joined.`,
      [ActivityType.MEMBER_LEFT]: `${who} left.`,
      [ActivityType.MEMBER_REMOVED]: `${who} was removed.`,
      [ActivityType.ROLE_APPOINTED]: `${who} was made ${role}.`,
      [ActivityType.ROLE_WITHDRAWN]: `${who} is no longer ${role}.`,
      [ActivityType.OWNERSHIP_TRANSFERRED]: `${who} now owns ${place.name}.`,
    };

    return { sentence: sentences[row.type] as string, path: place.path };
  }

  /**
   * Writes an item about a Fleet's place in an Armada.
   *
   * @param manager - The manager to read through.
   * @param row - The item.
   * @param place - Its scope, the Armada's or the Fleet's.
   * @returns The sentence and the Armada's page, or null when either has
   *   gone.
   */
  private async armadaSentence(
    manager: EntityManager,
    row: ActivityEventEntity,
    place: ActivityScopeDto,
  ): Promise<WrittenActivity | null> {
    // Every Armada item is recorded with its Fleet, Armada and positions.
    const detail = row.detail as Record<string, unknown>;
    const [fleet, armada] = await Promise.all([
      manager.findOne(StoFleetEntity, {
        where: { id: String(detail.fleetId) },
      }),
      manager.findOne(StoArmadaEntity, {
        where: { id: String(detail.armadaId) },
        relations: { platform: true },
      }),
    ]);

    if (fleet === null || armada === null) {
      return null;
    }

    const to = ARMADA_POSITION_NAMES[detail.to as ArmadaPosition];
    const from = ARMADA_POSITION_NAMES[detail.from as ArmadaPosition];
    const community = place.path.split('/').slice(0, 4).join('/');
    const path = `${community}/armadas/${toPlatformSegment(armada.platform.name)}/${armada.slug}`;
    const sentences: Partial<Record<ActivityType, string>> = {
      [ActivityType.ARMADA_FLEET_PLACED]: `${fleet.exactGameName} joined ${armada.exactGameName} as ${to}.`,
      [ActivityType.ARMADA_FLEET_MOVED]: `${fleet.exactGameName} moved from ${from} to ${to} in ${armada.exactGameName}.`,
      [ActivityType.ARMADA_FLEET_LEFT]: `${fleet.exactGameName} left ${armada.exactGameName}.`,
    };

    return { sentence: sentences[row.type] as string, path };
  }
}

/**
 * Names a day on an event's clock.
 *
 * @param instant - The instant.
 * @param timezone - The event's timezone.
 * @returns Such as "Fri 7 Dec".
 */
function dayIn(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(instant)
    .replace(',', '');
}
