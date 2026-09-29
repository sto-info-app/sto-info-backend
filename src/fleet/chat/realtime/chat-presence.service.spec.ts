import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { Redis } from 'ioredis';

import { UserPreferenceEntity } from 'src/user/entities/user-preference.entity';
import { PresenceVisibility } from 'src/user/enums/presence-visibility.enum';

import {
  ARMADA_ID,
  chatWorld,
  ChatWorld,
  COMMUNITY_ID,
  FLEET_ID,
  FRIEND_ID,
  MEMBER_ID,
  MODERATOR_ID,
  OTHER_FLEET_ID,
  STRANGER_ID,
} from '../../../../test/chat-world';
import { Row } from '../../../../test/in-memory-manager';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import {
  CHAT_PRESENCE_TTL_SECONDS,
  ChatPresenceService,
  presenceKey,
} from './chat-presence.service';

/** A Redis as presence uses it, keeping keys in memory. */
class FakeRedis {
  readonly keys = new Map<string, string>();
  readonly set = jest.fn(async (...args: unknown[]) => {
    this.keys.set(String(args[0]), String(args[1]));

    return 'OK';
  });
  readonly del = jest.fn(async (key: string) => Number(this.keys.delete(key)));
  readonly mget = jest.fn(async (...keys: string[]) =>
    keys.map(key => this.keys.get(key) ?? null),
  );
  readonly quit = jest.fn(async () => 'OK');
}

/**
 * A membership row.
 *
 * @param userId - Who.
 * @param fleetId - Of which Fleet.
 * @param status - Its status.
 * @returns The row.
 */
const membership = (
  userId: string,
  fleetId: string,
  status = ScopeMembershipStatus.APPROVED,
): Row => ({
  communityId: COMMUNITY_ID,
  fleetId,
  armadaId: null,
  userId,
  status,
  deletedAt: null,
});

describe('ChatPresenceService', () => {
  let world: ChatWorld;
  let redis: FakeRedis;
  let presence: ChatPresenceService;

  beforeEach(() => {
    world = chatWorld();
    redis = new FakeRedis();
    presence = new ChatPresenceService(
      world.db.asDataSource(),
      redis as unknown as Redis,
      world.direct,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Saves somebody's preferences.
   *
   * @param userId - Who.
   * @param row - What they chose.
   */
  const prefer = async (userId: string, row: Row): Promise<void> => {
    world.db.seed(UserPreferenceEntity, [
      {
        userId,
        presenceVisibility: PresenceVisibility.FRIENDS,
        appearOffline: false,
        typingIndicatorsEnabled: false,
        ...row,
      },
    ]);
    // As the watcher does when a preference is saved.
    await presence.refresh([userId]);
  };

  describe('touch and leave', () => {
    it('keeps somebody online for a minute at a time, and offline once gone', async () => {
      await presence.touch(MEMBER_ID);

      expect(redis.set).toHaveBeenCalledWith(
        presenceKey(MEMBER_ID),
        '1',
        'EX',
        CHAT_PRESENCE_TTL_SECONDS,
      );

      await presence.leave(MEMBER_ID);
      expect(redis.keys.has(presenceKey(MEMBER_ID))).toBe(false);
    });

    it('never marks online somebody who appears offline', async () => {
      await prefer(MEMBER_ID, { appearOffline: true });
      redis.keys.set(presenceKey(MEMBER_ID), '1');

      await presence.touch(MEMBER_ID);

      expect(redis.set).not.toHaveBeenCalled();
      expect(redis.keys.has(presenceKey(MEMBER_ID))).toBe(false);
    });

    it('takes somebody offline at once when they choose to appear offline', async () => {
      await presence.touch(MEMBER_ID);
      world.db.seed(UserPreferenceEntity, [
        {
          userId: MEMBER_ID,
          presenceVisibility: PresenceVisibility.FRIENDS,
          appearOffline: true,
          typingIndicatorsEnabled: false,
        },
      ]);

      await presence.refresh([MEMBER_ID, FRIEND_ID]);

      expect(redis.keys.has(presenceKey(MEMBER_ID))).toBe(false);
      expect(redis.del).toHaveBeenCalledTimes(1);
    });

    it('lets go of Redis with the application', async () => {
      await presence.onModuleDestroy();

      expect(redis.quit).toHaveBeenCalled();
    });
  });

  describe('preferences', () => {
    it('reads the defaults for somebody who saved none, typing off', async () => {
      await expect(presence.preferencesOf(MEMBER_ID)).resolves.toEqual({
        visibility: PresenceVisibility.FRIENDS,
        appearOffline: false,
        typing: false,
      });
      await expect(presence.typingEnabled(MEMBER_ID)).resolves.toBe(false);
    });

    it('reads what somebody chose, and trusts it for a few seconds', async () => {
      jest.useFakeTimers({ now: new Date('2026-09-29T12:00:00Z') });
      await prefer(MEMBER_ID, { typingIndicatorsEnabled: true });

      await expect(presence.typingEnabled(MEMBER_ID)).resolves.toBe(true);
      world.db.rows<Row>(UserPreferenceEntity)[0].typingIndicatorsEnabled =
        false;
      await expect(presence.typingEnabled(MEMBER_ID)).resolves.toBe(true);

      jest.advanceTimersByTime(5_000);
      await expect(presence.typingEnabled(MEMBER_ID)).resolves.toBe(false);
    });
  });

  describe('onlineFor', () => {
    beforeEach(async () => {
      for (const userId of [MEMBER_ID, MODERATOR_ID, FRIEND_ID, STRANGER_ID]) {
        await presence.touch(userId);
      }
    });

    /**
     * Who the member sees online, among everybody.
     *
     * @returns Each username seen online.
     */
    const seenOnline = async (): Promise<string[]> =>
      (
        await presence.onlineFor(MEMBER_ID, [
          'Member',
          'Moderator',
          'Friend',
          'Stranger',
          'Nobody',
        ])
      )
        .filter(each => each.online)
        .map(each => each.username);

    it('shows friends by default, and the viewer themself', async () => {
      world.befriend(MEMBER_ID, FRIEND_ID);

      await expect(seenOnline()).resolves.toEqual(['Member', 'Friend']);
    });

    it('shows to everybody somebody who chose everybody', async () => {
      await prefer(STRANGER_ID, {
        presenceVisibility: PresenceVisibility.EVERYONE,
      });

      await expect(seenOnline()).resolves.toEqual(['Member', 'Stranger']);
    });

    it('shows friends and fellow members of a Fleet or its Armada to those who chose them', async () => {
      for (const userId of [MODERATOR_ID, FRIEND_ID, STRANGER_ID]) {
        await prefer(userId, {
          presenceVisibility: PresenceVisibility.FLEETS_AND_ARMADAS,
        });
        await presence.touch(userId);
      }

      world.befriend(MEMBER_ID, FRIEND_ID);
      world.db
        .seed(ScopeMembershipEntity, [
          membership(MEMBER_ID, FLEET_ID),
          membership(MODERATOR_ID, OTHER_FLEET_ID),
          membership(STRANGER_ID, 'elsewhere'),
          membership(STRANGER_ID, FLEET_ID, ScopeMembershipStatus.PENDING),
        ])
        .seed(ArmadaFleetMembershipEntity, [
          { armadaId: ARMADA_ID, fleetId: FLEET_ID, validTo: null },
          { armadaId: ARMADA_ID, fleetId: OTHER_FLEET_ID, validTo: null },
        ]);

      await expect(seenOnline()).resolves.toEqual([
        'Member',
        'Moderator',
        'Friend',
      ]);
    });

    it('shares nothing through Fleets with a viewer in none, nor through a Fleet in no Armada', async () => {
      await prefer(MODERATOR_ID, {
        presenceVisibility: PresenceVisibility.FLEETS_AND_ARMADAS,
      });
      world.db.seed(ScopeMembershipEntity, [
        membership(MODERATOR_ID, FLEET_ID),
      ]);

      await expect(seenOnline()).resolves.toEqual(['Member']);

      world.db.seed(ScopeMembershipEntity, [membership(MEMBER_ID, FLEET_ID)]);
      await expect(seenOnline()).resolves.toEqual(['Member', 'Moderator']);
    });

    it('hides somebody offline, appearing offline, or across a block', async () => {
      for (const userId of [MODERATOR_ID, FRIEND_ID, STRANGER_ID]) {
        await prefer(userId, {
          presenceVisibility: PresenceVisibility.EVERYONE,
        });
      }

      world.db.rows<Row>(UserPreferenceEntity)[1].appearOffline = true;
      await presence.refresh([FRIEND_ID]);
      redis.keys.set(presenceKey(FRIEND_ID), '1');
      await presence.leave(MODERATOR_ID);
      world.block(STRANGER_ID, MEMBER_ID);

      await expect(seenOnline()).resolves.toEqual(['Member']);
    });

    it('answers nothing for nobody it knows', async () => {
      await expect(presence.onlineFor(MEMBER_ID, ['Nobody'])).resolves.toEqual(
        [],
      );
      expect(redis.mget).not.toHaveBeenCalled();
    });
  });
});
