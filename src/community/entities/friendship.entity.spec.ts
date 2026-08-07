import { FriendshipEntity } from './friendship.entity';

describe('FriendshipEntity', () => {
  /**
   * Builds a friendship between two known members.
   *
   * @returns The friendship entity.
   */
  function buildFriendship(): FriendshipEntity {
    const friendship = new FriendshipEntity();
    friendship.requesterId = 'requester-1';
    friendship.addresseeId = 'addressee-1';
    return friendship;
  }

  describe('otherUserId', () => {
    it('should return the addressee when asked from the requester side', () => {
      expect(buildFriendship().otherUserId('requester-1')).toBe('addressee-1');
    });

    it('should return the requester when asked from the addressee side', () => {
      expect(buildFriendship().otherUserId('addressee-1')).toBe('requester-1');
    });
  });
});
