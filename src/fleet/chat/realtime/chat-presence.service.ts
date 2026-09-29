import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import type { Redis } from 'ioredis';
import { DataSource, In, IsNull } from 'typeorm';

import { UserPreferenceEntity } from 'src/user/entities/user-preference.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { PresenceVisibility } from 'src/user/enums/presence-visibility.enum';

import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ChatPresenceDto } from '../dto/chat.dto';
import { ChatDirectService } from '../services/chat-direct.service';

/** The Redis connection chat's presence keeps its keys in. */
export const CHAT_REDIS = Symbol('CHAT_REDIS');

/** How long somebody stays online after their last heartbeat, in seconds. */
export const CHAT_PRESENCE_TTL_SECONDS = 60;

/** How long a person's chat preferences are trusted, in milliseconds. */
const PREFERENCES_TTL_MS = 5_000;

/** What presence and typing need of somebody's preferences. */
export interface ChatPreferences {
  readonly visibility: PresenceVisibility;
  readonly appearOffline: boolean;
  readonly typing: boolean;
}

/** The defaults for somebody who has never saved a preference. */
const DEFAULT_PREFERENCES: ChatPreferences = {
  visibility: PresenceVisibility.FRIENDS,
  appearOffline: false,
  typing: false,
};

/**
 * The Redis key saying somebody is online.
 *
 * @param userId - The person.
 * @returns The key.
 */
export const presenceKey = (userId: string): string =>
  `chat:presence:${userId}`;

/**
 * Who is online on STO Info, and who may know it (FC-034).
 *
 * Steve's decisions of 28 and 29 September 2026: somebody is online while
 * any tab of theirs holds a chat connection — every signed-in tab does,
 * while chat is on — and for 60 seconds after its last heartbeat, so a tab
 * that dies without saying so drops off by itself. Never a guess at whether
 * they are in the game. Each person chooses who may see it: everybody,
 * friends, or friends and the people they share a Fleet or an Armada with;
 * appearing offline hides it from everybody. Nobody across a block from them
 * ever sees it.
 */
@Injectable()
export class ChatPresenceService implements OnModuleDestroy {
  /** Recent preferences, by person, and until when. */
  private readonly _preferences = new Map<
    string,
    { readonly value: ChatPreferences; readonly until: number }
  >();

  /**
   * Creates an instance of ChatPresenceService.
   *
   * @param _dataSource - The database.
   * @param _redis - Where presence is kept.
   * @param _direct - Says who is friends with whom, and blocks.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    @Inject(CHAT_REDIS)
    private readonly _redis: Redis,
    private readonly _direct: ChatDirectService,
  ) {}

  /**
   * Lets go of Redis with the application.
   */
  async onModuleDestroy(): Promise<void> {
    await this._redis.quit();
  }

  /**
   * Marks somebody online for another minute, unless they appear offline.
   *
   * @param userId - The person.
   */
  async touch(userId: string): Promise<void> {
    if ((await this.preferencesOf(userId)).appearOffline) {
      await this._redis.del(presenceKey(userId));
    } else {
      await this._redis.set(
        presenceKey(userId),
        '1',
        'EX',
        CHAT_PRESENCE_TTL_SECONDS,
      );
    }
  }

  /**
   * Marks somebody offline: their last socket has gone.
   *
   * @param userId - The person.
   */
  async leave(userId: string): Promise<void> {
    await this._redis.del(presenceKey(userId));
  }

  /**
   * Forgets what is known of some people's preferences, and takes them
   * offline at once if they now appear offline.
   *
   * @param userIds - The people.
   */
  async refresh(userIds: readonly string[]): Promise<void> {
    for (const userId of userIds) {
      this._preferences.delete(userId);

      if ((await this.preferencesOf(userId)).appearOffline) {
        await this.leave(userId);
      }
    }
  }

  /**
   * Whether somebody shares their typing, and sees others'.
   *
   * @param userId - The person.
   * @returns True when their indicator is on.
   */
  async typingEnabled(userId: string): Promise<boolean> {
    return (await this.preferencesOf(userId)).typing;
  }

  /**
   * Who of some people is online, as a viewer may know it. Anybody the
   * viewer may not see is simply not online, so the answer tells nothing of
   * their choice.
   *
   * @param viewerId - Who is asking.
   * @param usernames - The people, by username.
   * @returns Each person found, and whether they are online to the viewer.
   */
  async onlineFor(
    viewerId: string,
    usernames: readonly string[],
  ): Promise<ChatPresenceDto[]> {
    const profiles = await this._dataSource.manager.find(UserProfileEntity, {
      where: { username: In([...usernames]) },
      select: { userId: true, username: true },
    });

    if (profiles.length === 0) {
      return [];
    }

    const ids = profiles.map(profile => profile.userId);
    const [online, blocked, friends, shared] = await Promise.all([
      this._redis.mget(...ids.map(presenceKey)),
      this._direct.blockedFor(viewerId),
      this._direct.friendsAmong(viewerId, ids),
      this.sharingWith(viewerId),
    ]);
    const answers: ChatPresenceDto[] = [];

    for (const [index, profile] of profiles.entries()) {
      const preferences = await this.preferencesOf(profile.userId);
      const audience =
        profile.userId === viewerId ||
        preferences.visibility === PresenceVisibility.EVERYONE ||
        friends.has(profile.userId) ||
        (preferences.visibility === PresenceVisibility.FLEETS_AND_ARMADAS &&
          shared.has(profile.userId));

      answers.push({
        username: profile.username,
        online:
          online[index] !== null &&
          !preferences.appearOffline &&
          !blocked.has(profile.userId) &&
          audience,
      });
    }

    return answers;
  }

  /**
   * Somebody's chat preferences, trusted for a few seconds.
   *
   * @param userId - The person.
   * @returns Their preferences, or the defaults.
   */
  async preferencesOf(userId: string): Promise<ChatPreferences> {
    const known = this._preferences.get(userId);

    if (known !== undefined && known.until > Date.now()) {
      return known.value;
    }

    const row = await this._dataSource.manager.findOne(UserPreferenceEntity, {
      where: { userId },
    });
    const value: ChatPreferences =
      row === null
        ? DEFAULT_PREFERENCES
        : {
            visibility: row.presenceVisibility,
            appearOffline: row.appearOffline,
            typing: row.typingIndicatorsEnabled,
          };

    this._preferences.set(userId, {
      value,
      until: Date.now() + PREFERENCES_TTL_MS,
    });

    return value;
  }

  /**
   * The people who share a Fleet with somebody, or a Fleet in the same
   * Armada, as members now.
   *
   * @param userId - The person.
   * @returns Their fellow members.
   */
  private async sharingWith(userId: string): Promise<Set<string>> {
    const manager = this._dataSource.manager;
    const approved = {
      status: ScopeMembershipStatus.APPROVED,
      deletedAt: IsNull(),
    };
    const own = await manager.find(ScopeMembershipEntity, {
      where: { ...approved, userId },
    });
    const fleetIds = own
      .map(membership => membership.fleetId)
      .filter((id): id is string => id !== null);

    if (fleetIds.length === 0) {
      return new Set();
    }

    const placements = await manager.find(ArmadaFleetMembershipEntity, {
      where: { fleetId: In(fleetIds), validTo: IsNull() },
    });
    const armadaIds = [...new Set(placements.map(each => each.armadaId))];
    const allied =
      armadaIds.length === 0
        ? []
        : await manager.find(ArmadaFleetMembershipEntity, {
            where: { armadaId: In(armadaIds), validTo: IsNull() },
          });
    const fellows = await manager.find(ScopeMembershipEntity, {
      where: {
        ...approved,
        fleetId: In([
          ...new Set([...fleetIds, ...allied.map(each => each.fleetId)]),
        ]),
      },
    });

    return new Set(fellows.map(membership => membership.userId));
  }
}
