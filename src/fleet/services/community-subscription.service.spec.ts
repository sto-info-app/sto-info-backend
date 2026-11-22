import { IsNull, QueryFailedError, Repository } from 'typeorm';

import { CommunitySubscriptionEntity } from '../entities/community-subscription.entity';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { CommunitySubscriptionService } from './community-subscription.service';

const COMMUNITY_ID = '40000000-0000-4000-8000-000000000001';
const USER_ID = '40000000-0000-4000-8000-000000000002';

/** The live-subscription query every read uses. */
const LIVE_WHERE = {
  communityId: COMMUNITY_ID,
  userId: USER_ID,
  leftAt: IsNull(),
  deletedAt: IsNull(),
};

/**
 * Builds the error PostgreSQL raises when an index refuses a second row.
 *
 * @returns The refusal, shaped as TypeORM reports it.
 */
function duplicateKey(): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO community_subscription',
    [],
    new Error(
      'duplicate key value violates unique constraint ' +
        '"UX_community_subscription_live"',
    ),
  );
}

describe('CommunitySubscriptionService', () => {
  let service: CommunitySubscriptionService;
  let repository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
  };

  beforeEach(() => {
    repository = {
      findOne: jest.fn(() => Promise.resolve(null)),
      find: jest.fn(() => Promise.resolve([])),
      create: jest.fn((values: Partial<CommunitySubscriptionEntity>) => values),
      save: jest.fn((values: Partial<CommunitySubscriptionEntity>) =>
        Promise.resolve({ id: 'subscription-1', ...values }),
      ),
      count: jest.fn(() => Promise.resolve(0)),
    };

    service = new CommunitySubscriptionService(
      repository as unknown as Repository<CommunitySubscriptionEntity>,
    );
  });

  describe('follow', () => {
    it('records a subscription that was not there', async () => {
      await expect(service.follow(COMMUNITY_ID, USER_ID)).resolves.toEqual(
        expect.objectContaining({
          communityId: COMMUNITY_ID,
          userId: USER_ID,
          leftAt: null,
        }),
      );
      expect(repository.save).toHaveBeenCalled();
    });

    /*
     * A follow button pressed twice, or pressed on a stale page, is somebody
     * saying they want to follow. Answering the second press with a conflict
     * would tell them off for agreeing with themselves.
     */
    it('returns the existing one rather than adding a second', async () => {
      const existing = { id: 'subscription-9' };

      repository.findOne.mockResolvedValue(existing);

      await expect(service.follow(COMMUNITY_ID, USER_ID)).resolves.toBe(
        existing,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('reads only live rows when looking for one', async () => {
      await service.follow(COMMUNITY_ID, USER_ID);

      expect(repository.findOne).toHaveBeenCalledWith({ where: LIVE_WHERE });
    });

    /*
     * Two presses arriving together both find nothing and both insert. The
     * index refuses one, and that refusal is the answer "somebody already
     * did this" — so it re-reads rather than raising.
     */
    it('answers a race with the row that won it', async () => {
      const winner = { id: 'subscription-7' };

      repository.save.mockRejectedValue(duplicateKey());
      repository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner);

      await expect(service.follow(COMMUNITY_ID, USER_ID)).resolves.toBe(winner);
    });

    /*
     * A duplicate with nothing behind it is not a race — it is a broken
     * assumption, and swallowing it would hide the breakage.
     */
    it('raises a duplicate that leaves no row to find', async () => {
      repository.save.mockRejectedValue(duplicateKey());

      await expect(service.follow(COMMUNITY_ID, USER_ID)).rejects.toThrow(
        QueryFailedError,
      );
    });

    it('raises anything that is not a duplicate', async () => {
      repository.save.mockRejectedValue(new Error('connection lost'));

      await expect(service.follow(COMMUNITY_ID, USER_ID)).rejects.toThrow(
        'connection lost',
      );
    });

    it('raises a query failure that is not about a duplicate', async () => {
      repository.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], new Error('deadlock detected')),
      );

      await expect(service.follow(COMMUNITY_ID, USER_ID)).rejects.toThrow(
        QueryFailedError,
      );
    });
  });

  describe('unfollow', () => {
    /*
     * A stamp rather than a delete, so "followed once" stays answerable long
     * after somebody has gone quiet.
     */
    it('stamps the row rather than removing it', async () => {
      const existing = { id: 'subscription-1', leftAt: null };

      repository.findOne.mockResolvedValue(existing);

      await service.unfollow(COMMUNITY_ID, USER_ID);

      expect(existing.leftAt).toBeInstanceOf(Date);
      expect(repository.save).toHaveBeenCalledWith(existing);
    });

    /*
     * The caller asked for a state, not for a transition, and they are in
     * it.
     */
    it('does nothing when they were not following', async () => {
      await service.unfollow(COMMUNITY_ID, USER_ID);

      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('isFollowing', () => {
    it('is true when a live subscription exists', async () => {
      repository.findOne.mockResolvedValue({ id: 'subscription-1' });

      await expect(service.isFollowing(COMMUNITY_ID, USER_ID)).resolves.toBe(
        true,
      );
    });

    it('is false when none does', async () => {
      await expect(service.isFollowing(COMMUNITY_ID, USER_ID)).resolves.toBe(
        false,
      );
    });

    /*
     * Nobody signed out follows anything, and that is knowable without a
     * query — a scope page is served far more often to visitors than to
     * followers.
     */
    it('answers a signed-out caller without asking the database', async () => {
      await expect(service.isFollowing(COMMUNITY_ID, null)).resolves.toBe(
        false,
      );
      expect(repository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('countFollowers', () => {
    it('counts the live followers only', async () => {
      repository.count.mockResolvedValue(12);

      await expect(service.countFollowers(COMMUNITY_ID)).resolves.toBe(12);
      expect(repository.count).toHaveBeenCalledWith({
        where: {
          communityId: COMMUNITY_ID,
          leftAt: IsNull(),
          deletedAt: IsNull(),
        },
      });
    });
  });

  describe('listFollowed', () => {
    const community = { id: COMMUNITY_ID } as FleetCommunityEntity;
    const followedAt = new Date('2026-05-01T00:00:00.000Z');

    it('lists what they follow, newest first', async () => {
      repository.find.mockResolvedValue([
        { communityId: COMMUNITY_ID, joinedAt: followedAt, community },
      ]);

      await expect(service.listFollowed(USER_ID)).resolves.toEqual([
        { community, followedAt },
      ]);
      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: USER_ID, leftAt: IsNull(), deletedAt: IsNull() },
        relations: { community: true },
        order: { joinedAt: 'DESC' },
      });
    });

    /*
     * The join drops a soft-deleted Community, and the subscription goes
     * with it. The record is kept — it is still evidence of who followed
     * what — but a list of Communities does not report one that is gone.
     */
    it('leaves out a subscription whose Community has gone', async () => {
      repository.find.mockResolvedValue([
        { communityId: COMMUNITY_ID, joinedAt: followedAt, community: null },
      ]);

      await expect(service.listFollowed(USER_ID)).resolves.toEqual([]);
    });
  });
});
