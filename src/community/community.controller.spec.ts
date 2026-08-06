import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BlockService } from './block.service';
import { CommunityController } from './community.controller';
import { FriendRequestDirection } from './enums/friend-request-direction.enum';
import { FriendshipService } from './friendship.service';

const VIEWER_ID = 'viewer-1';

describe('CommunityController', () => {
  let controller: CommunityController;
  let friendshipService: jest.Mocked<FriendshipService>;
  let blockService: jest.Mocked<BlockService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommunityController],
      providers: [
        {
          provide: FriendshipService,
          useValue: {
            getSummary: jest.fn(),
            findFriends: jest.fn(),
            removeFriend: jest.fn(),
            findRequests: jest.fn(),
            sendRequest: jest.fn(),
            acceptRequest: jest.fn(),
            declineRequest: jest.fn(),
            cancelRequest: jest.fn(),
          },
        },
        {
          provide: BlockService,
          useValue: {
            findBlockedMembers: jest.fn(),
            blockMember: jest.fn(),
            unblockMember: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CommunityController>(CommunityController);
    friendshipService = module.get(FriendshipService);
    blockService = module.get(BlockService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSummary', () => {
    it('should delegate the caller to the service', () => {
      controller.getSummary(VIEWER_ID);

      expect(friendshipService.getSummary).toHaveBeenCalledWith(VIEWER_ID);
    });
  });

  describe('findFriends', () => {
    it('should delegate the caller and query to the service', () => {
      const query = { search: 'picard', page: 2 };

      controller.findFriends(VIEWER_ID, query);

      expect(friendshipService.findFriends).toHaveBeenCalledWith(
        VIEWER_ID,
        query,
      );
    });
  });

  describe('removeFriend', () => {
    it('should delegate the friendship to the service', () => {
      controller.removeFriend(VIEWER_ID, 'friendship-1');

      expect(friendshipService.removeFriend).toHaveBeenCalledWith(
        VIEWER_ID,
        'friendship-1',
      );
    });
  });

  describe('findRequests', () => {
    it('should default to incoming requests', () => {
      controller.findRequests(VIEWER_ID, {});

      expect(friendshipService.findRequests).toHaveBeenCalledWith(
        VIEWER_ID,
        FriendRequestDirection.INCOMING,
      );
    });

    it('should pass an explicit direction through', () => {
      controller.findRequests(VIEWER_ID, {
        direction: FriendRequestDirection.OUTGOING,
      });

      expect(friendshipService.findRequests).toHaveBeenCalledWith(
        VIEWER_ID,
        FriendRequestDirection.OUTGOING,
      );
    });
  });

  describe('sendRequest', () => {
    it('should delegate the recipient to the service', () => {
      const dto = { username: 'captain.picard' };

      controller.sendRequest(VIEWER_ID, dto);

      expect(friendshipService.sendRequest).toHaveBeenCalledWith(
        VIEWER_ID,
        dto,
      );
    });
  });

  describe('acceptRequest', () => {
    it('should delegate the request to the service', () => {
      controller.acceptRequest(VIEWER_ID, 'friendship-1');

      expect(friendshipService.acceptRequest).toHaveBeenCalledWith(
        VIEWER_ID,
        'friendship-1',
      );
    });
  });

  describe('declineRequest', () => {
    it('should delegate the request to the service', () => {
      controller.declineRequest(VIEWER_ID, 'friendship-1');

      expect(friendshipService.declineRequest).toHaveBeenCalledWith(
        VIEWER_ID,
        'friendship-1',
      );
    });
  });

  describe('cancelRequest', () => {
    it('should delegate the request to the service', () => {
      controller.cancelRequest(VIEWER_ID, 'friendship-1');

      expect(friendshipService.cancelRequest).toHaveBeenCalledWith(
        VIEWER_ID,
        'friendship-1',
      );
    });
  });

  describe('findBlockedMembers', () => {
    it('should delegate the caller to the service', () => {
      controller.findBlockedMembers(VIEWER_ID);

      expect(blockService.findBlockedMembers).toHaveBeenCalledWith(VIEWER_ID);
    });
  });

  describe('blockMember', () => {
    it('should delegate the target and note to the service', () => {
      const dto = { username: 'captain.picard', reason: 'Harassment' };

      controller.blockMember(VIEWER_ID, dto);

      expect(blockService.blockMember).toHaveBeenCalledWith(VIEWER_ID, dto);
    });
  });

  describe('unblockMember', () => {
    it('should delegate the block to the service', () => {
      controller.unblockMember(VIEWER_ID, 'block-1');

      expect(blockService.unblockMember).toHaveBeenCalledWith(
        VIEWER_ID,
        'block-1',
      );
    });
  });
});
