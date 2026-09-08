import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { UserRole } from 'src/user/enums/user-role.enum';
import { UserService } from 'src/user/user.service';

import { NotificationSeverity } from './enums/notification-severity.enum';
import { NotificationTarget } from './enums/notification-target.enum';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

describe('NotificationController', () => {
  let controller: NotificationController;
  let service: jest.Mocked<NotificationService>;
  let userService: jest.Mocked<UserService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        {
          provide: NotificationService,
          useValue: {
            findActiveBanners: jest.fn(),
            getInbox: jest.fn(),
            getUnreadCount: jest.fn(),
            markAllRead: jest.fn(),
            markRead: jest.fn(),
            markUnread: jest.fn(),
            findAllBanners: jest.fn(),
            findBannerById: jest.fn(),
            createBanner: jest.fn(),
            updateBanner: jest.fn(),
            removeBanner: jest.fn(),
            findAllNotifications: jest.fn(),
            createNotification: jest.fn(),
            removeNotification: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            searchUsers: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(NotificationController);
    service = module.get(NotificationService);
    userService = module.get(UserService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findActiveBanners', () => {
    it('calls service and returns result', () => {
      const banners = [{ id: 'b1' }];
      service.findActiveBanners.mockResolvedValue(banners as any);

      controller.findActiveBanners();

      expect(service.findActiveBanners).toHaveBeenCalled();
    });
  });

  describe('getInbox', () => {
    it('delegates inbox with user id', () => {
      controller.getInbox('user-1', { page: 1 });
      expect(service.getInbox).toHaveBeenCalledWith('user-1', { page: 1 });
    });

    it('passes unreadOnly filter to service', () => {
      controller.getInbox('user-1', { unreadOnly: true });
      expect(service.getInbox).toHaveBeenCalledWith('user-1', {
        unreadOnly: true,
      });
    });

    it('passes custom pageSize to service', () => {
      controller.getInbox('user-1', { page: 2, pageSize: 25 });
      expect(service.getInbox).toHaveBeenCalledWith('user-1', {
        page: 2,
        pageSize: 25,
      });
    });
  });

  describe('getUnreadCount', () => {
    it('wraps unread count', async () => {
      service.getUnreadCount.mockResolvedValue(5);
      await expect(controller.getUnreadCount('user-1')).resolves.toEqual({
        unreadCount: 5,
      });
    });

    it('calls service with correct user id', async () => {
      service.getUnreadCount.mockResolvedValue(0);
      await controller.getUnreadCount('user-1');
      expect(service.getUnreadCount).toHaveBeenCalledWith('user-1');
    });
  });

  describe('markAllRead', () => {
    it('wraps mark all read response', async () => {
      service.markAllRead.mockResolvedValue(2);
      await expect(controller.markAllRead('user-1')).resolves.toEqual({
        marked: 2,
      });
    });

    it('calls service with correct user id', async () => {
      service.markAllRead.mockResolvedValue(0);
      await controller.markAllRead('user-1');
      expect(service.markAllRead).toHaveBeenCalledWith('user-1');
    });

    it('returns 0 when no notifications marked', async () => {
      service.markAllRead.mockResolvedValue(0);
      await expect(controller.markAllRead('user-1')).resolves.toEqual({
        marked: 0,
      });
    });
  });

  describe('markRead', () => {
    it('delegates mark read', () => {
      controller.markRead('user-1', 'n1');
      expect(service.markRead).toHaveBeenCalledWith('user-1', 'n1');
    });

    it('passes different notification id', () => {
      controller.markRead('user-1', 'different-n-id');
      expect(service.markRead).toHaveBeenCalledWith('user-1', 'different-n-id');
    });

    it('passes different user id', () => {
      controller.markRead('user-xyz', 'n1');
      expect(service.markRead).toHaveBeenCalledWith('user-xyz', 'n1');
    });
  });

  describe('markUnread', () => {
    it('delegates mark unread', () => {
      controller.markUnread('user-1', 'n1');
      expect(service.markUnread).toHaveBeenCalledWith('user-1', 'n1');
    });

    it('passes different notification id', () => {
      controller.markUnread('user-1', 'different-n-id');
      expect(service.markUnread).toHaveBeenCalledWith(
        'user-1',
        'different-n-id',
      );
    });

    it('passes different user id', () => {
      controller.markUnread('user-xyz', 'n1');
      expect(service.markUnread).toHaveBeenCalledWith('user-xyz', 'n1');
    });
  });

  describe('findAllBanners', () => {
    it('calls service and returns result', () => {
      const banners = [{ id: 'b1' }, { id: 'b2' }];
      service.findAllBanners.mockResolvedValue(banners as any);

      controller.findAllBanners();

      expect(service.findAllBanners).toHaveBeenCalled();
    });
  });

  describe('findBanner', () => {
    it('finds a banner by id', () => {
      controller.findBanner('b1');
      expect(service.findBannerById).toHaveBeenCalledWith('b1');
    });

    it('passes different banner id', () => {
      controller.findBanner('different-id');
      expect(service.findBannerById).toHaveBeenCalledWith('different-id');
    });
  });

  describe('createBanner', () => {
    it('delegates create banner', () => {
      const dto = { message: 'm' };
      controller.createBanner(dto);
      expect(service.createBanner).toHaveBeenCalledWith(dto);
    });

    it('passes complete banner dto', () => {
      const dto = {
        severity: NotificationSeverity.CRITICAL,
        message: 'Error message',
        title: 'Title',
        active: false,
      };
      controller.createBanner(dto);
      expect(service.createBanner).toHaveBeenCalledWith(dto);
    });
  });

  describe('updateBanner', () => {
    it('delegates update banner', () => {
      controller.updateBanner('b1', { active: false });
      expect(service.updateBanner).toHaveBeenCalledWith('b1', {
        active: false,
      });
    });

    it('passes different banner id', () => {
      controller.updateBanner('different-id', { active: true });
      expect(service.updateBanner).toHaveBeenCalledWith('different-id', {
        active: true,
      });
    });

    it('passes complete update dto', () => {
      const dto = { title: 'New', message: 'New message', active: false };
      controller.updateBanner('b1', dto);
      expect(service.updateBanner).toHaveBeenCalledWith('b1', dto);
    });
  });

  describe('removeBanner', () => {
    it('delegates remove banner', () => {
      controller.removeBanner('b1');
      expect(service.removeBanner).toHaveBeenCalledWith('b1');
    });

    it('passes different banner id', () => {
      controller.removeBanner('different-id');
      expect(service.removeBanner).toHaveBeenCalledWith('different-id');
    });
  });

  describe('findAllNotifications', () => {
    it('calls service and returns result', () => {
      const notifications = [{ id: 'n1' }];
      service.findAllNotifications.mockResolvedValue(notifications as any);

      controller.findAllNotifications();

      expect(service.findAllNotifications).toHaveBeenCalled();
    });
  });

  describe('createNotification', () => {
    it('delegates create notification', () => {
      const dto = { title: 't', body: 'b' };
      controller.createNotification(dto);
      expect(service.createNotification).toHaveBeenCalledWith(dto);
    });

    it('passes broadcast notification dto', () => {
      const dto = {
        target: NotificationTarget.BROADCAST,
        title: 't',
        body: 'b',
      };
      controller.createNotification(dto);
      expect(service.createNotification).toHaveBeenCalledWith(dto);
    });

    it('passes user-targeted notification dto', () => {
      const dto = {
        target: NotificationTarget.USER,
        userId: 'user-1',
        title: 't',
        body: 'b',
      };
      controller.createNotification(dto);
      expect(service.createNotification).toHaveBeenCalledWith(dto);
    });
  });

  describe('removeNotification', () => {
    it('delegates remove notification', () => {
      controller.removeNotification('n1');
      expect(service.removeNotification).toHaveBeenCalledWith('n1');
    });

    it('passes different notification id', () => {
      controller.removeNotification('different-id');
      expect(service.removeNotification).toHaveBeenCalledWith('different-id');
    });
  });

  describe('searchUsers', () => {
    it('delegates to userService', () => {
      const query = { q: 'john', page: 1, pageSize: 5 };
      userService.searchUsers.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 5,
      });
      controller.searchUsers(query as any);
      expect(userService.searchUsers).toHaveBeenCalledWith(query);
    });

    it('passes a search with results through', async () => {
      const result = {
        items: [
          {
            id: 'u1',
            username: 'kirk',
            fullName: 'James Kirk',
            role: UserRole.USER,
            lastLoginAt: new Date('2026-05-01T09:00:00.000Z'),
          },
        ],
        total: 1,
        page: 1,
        pageSize: 5,
      };
      userService.searchUsers.mockResolvedValue(result);
      await expect(
        controller.searchUsers({ q: 'kirk' } as any),
      ).resolves.toEqual(result);
    });

    it('passes empty results through', async () => {
      userService.searchUsers.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 5,
      });
      await expect(
        controller.searchUsers({ q: 'nobody' } as any),
      ).resolves.toMatchObject({ total: 0 });
    });
  });
});
