import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

describe('NotificationController', () => {
  let controller: NotificationController;
  let service: jest.Mocked<NotificationService>;

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
      ],
    }).compile();

    controller = module.get(NotificationController);
    service = module.get(NotificationService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists active banners', () => {
    controller.findActiveBanners();
    expect(service.findActiveBanners).toHaveBeenCalled();
  });

  it('delegates inbox with user id', () => {
    controller.getInbox('user-1', { page: 1 });
    expect(service.getInbox).toHaveBeenCalledWith('user-1', { page: 1 });
  });

  it('wraps unread count', async () => {
    service.getUnreadCount.mockResolvedValue(5);
    await expect(controller.getUnreadCount('user-1')).resolves.toEqual({
      unreadCount: 5,
    });
  });

  it('wraps mark all read', async () => {
    service.markAllRead.mockResolvedValue(2);
    await expect(controller.markAllRead('user-1')).resolves.toEqual({
      marked: 2,
    });
  });

  it('delegates mark read', () => {
    controller.markRead('user-1', 'n1');
    expect(service.markRead).toHaveBeenCalledWith('user-1', 'n1');
  });

  it('delegates create banner', () => {
    controller.createBanner({ message: 'm' });
    expect(service.createBanner).toHaveBeenCalledWith({ message: 'm' });
  });

  it('delegates update banner', () => {
    controller.updateBanner('b1', { active: false });
    expect(service.updateBanner).toHaveBeenCalledWith('b1', { active: false });
  });

  it('delegates remove banner', () => {
    controller.removeBanner('b1');
    expect(service.removeBanner).toHaveBeenCalledWith('b1');
  });

  it('delegates create notification', () => {
    controller.createNotification({ title: 't', body: 'b' });
    expect(service.createNotification).toHaveBeenCalledWith({
      title: 't',
      body: 'b',
    });
  });

  it('delegates remove notification', () => {
    controller.removeNotification('n1');
    expect(service.removeNotification).toHaveBeenCalledWith('n1');
  });
});
