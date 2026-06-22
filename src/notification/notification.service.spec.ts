import { jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BannerEntity } from './entities/banner.entity';
import { NotificationReadEntity } from './entities/notification-read.entity';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationTarget } from './enums/notification-target.enum';
import { NotificationService } from './notification.service';

/**
 * Builds a chainable query-builder mock whose terminal methods resolve to the
 * supplied values.
 */
const createQbMock = (overrides: Record<string, unknown> = {}) => {
  const qb: Record<string, jest.Mock> = {};
  const chain =
    () =>
    (...args: unknown[]) => {
      void args;
      return qb;
    };
  for (const method of [
    'where',
    'andWhere',
    'addSelect',
    'orderBy',
    'skip',
    'take',
    'leftJoin',
    'insert',
    'values',
    'orIgnore',
  ]) {
    qb[method] = jest.fn(chain());
  }
  qb.getMany = jest.fn(async () => overrides.getMany ?? []);
  qb.getRawAndEntities = jest.fn(
    async () => overrides.getRawAndEntities ?? { entities: [], raw: [] },
  );
  qb.getCount = jest.fn(async () => overrides.getCount ?? 0);
  qb.getExists = jest.fn(async () => overrides.getExists ?? false);
  qb.execute = jest.fn(async () => overrides.execute ?? {});
  return qb;
};

describe('NotificationService', () => {
  let service: NotificationService;
  let bannerRepo: jest.Mocked<Repository<BannerEntity>>;
  let notificationRepo: jest.Mocked<Repository<NotificationEntity>>;
  let readRepo: jest.Mocked<Repository<NotificationReadEntity>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getRepositoryToken(BannerEntity),
          useValue: {
            createQueryBuilder: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            softRemove: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(NotificationEntity),
          useValue: {
            createQueryBuilder: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            softRemove: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(NotificationReadEntity),
          useValue: { createQueryBuilder: jest.fn(), delete: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(NotificationService);
    bannerRepo = module.get(getRepositoryToken(BannerEntity));
    notificationRepo = module.get(getRepositoryToken(NotificationEntity));
    readRepo = module.get(getRepositoryToken(NotificationReadEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findActiveBanners', () => {
    it('queries active banners within their window', async () => {
      const banners = [{ id: 'b1' }] as BannerEntity[];
      const qb = createQbMock({ getMany: banners });
      bannerRepo.createQueryBuilder.mockReturnValue(qb as never);

      await expect(service.findActiveBanners()).resolves.toBe(banners);
      expect(qb.where).toHaveBeenCalled();
    });
  });

  describe('getAppState', () => {
    it('returns banners with the unread count for an authenticated user', async () => {
      const banners = [{ id: 'b1' }] as BannerEntity[];
      const bannerQb = createQbMock({ getMany: banners });
      bannerRepo.createQueryBuilder.mockReturnValue(bannerQb as never);
      const unreadQb = createQbMock({ getCount: 3 });
      notificationRepo.createQueryBuilder.mockReturnValue(unreadQb as never);

      await expect(service.getAppState('user-1')).resolves.toEqual({
        banners,
        unreadCount: 3,
      });
    });

    it('returns banners with a zero count for an anonymous caller', async () => {
      const banners = [{ id: 'b1' }] as BannerEntity[];
      const bannerQb = createQbMock({ getMany: banners });
      bannerRepo.createQueryBuilder.mockReturnValue(bannerQb as never);

      await expect(service.getAppState(null)).resolves.toEqual({
        banners,
        unreadCount: 0,
      });
      expect(notificationRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('createBanner', () => {
    it('applies defaults for dismissible and active', async () => {
      (bannerRepo.create as jest.Mock).mockImplementation(
        (v: unknown) => v as BannerEntity,
      );
      (bannerRepo.save as jest.Mock).mockImplementation(
        async (v: unknown) => v as BannerEntity,
      );

      const result = await service.createBanner({ message: 'Hi' });

      expect(result.dismissible).toBe(true);
      expect(result.active).toBe(true);
    });
  });

  describe('findBannerById', () => {
    it('throws when not found', async () => {
      bannerRepo.findOne.mockResolvedValue(null);
      await expect(service.findBannerById('x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getInbox', () => {
    it('annotates items with read state and returns counts', async () => {
      const notification = { id: 'n1' } as NotificationEntity;
      const readAt = new Date('2026-01-01T00:00:00Z');
      const listQb = createQbMock({
        getRawAndEntities: {
          entities: [notification],
          raw: [{ r_readAt: readAt }],
        },
      });
      const countQb = createQbMock({ getCount: 1 });
      const unreadQb = createQbMock({ getCount: 0 });
      notificationRepo.createQueryBuilder
        .mockReturnValueOnce(listQb as never)
        .mockReturnValueOnce(countQb as never)
        .mockReturnValueOnce(unreadQb as never);

      const result = await service.getInbox('user-1', {});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].isRead).toBe(true);
      expect(result.total).toBe(1);
      expect(result.unreadCount).toBe(0);
    });
  });

  describe('getUnreadCount', () => {
    it('returns the unread count', async () => {
      const qb = createQbMock({ getCount: 3 });
      notificationRepo.createQueryBuilder.mockReturnValue(qb as never);

      await expect(service.getUnreadCount('user-1')).resolves.toBe(3);
      expect(qb.andWhere).toHaveBeenCalledWith('r.id IS NULL');
    });
  });

  describe('markRead', () => {
    it('inserts a read row when the notification is in scope', async () => {
      const scopeQb = createQbMock({ getExists: true });
      notificationRepo.createQueryBuilder.mockReturnValue(scopeQb as never);
      const insertQb = createQbMock();
      readRepo.createQueryBuilder.mockReturnValue(insertQb as never);

      await service.markRead('user-1', 'n1');

      expect(insertQb.insert).toHaveBeenCalled();
      expect(insertQb.orIgnore).toHaveBeenCalled();
      expect(insertQb.execute).toHaveBeenCalled();
    });

    it('throws when the notification is not in scope', async () => {
      const scopeQb = createQbMock({ getExists: false });
      notificationRepo.createQueryBuilder.mockReturnValue(scopeQb as never);

      await expect(service.markRead('user-1', 'n1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('markAllRead', () => {
    it('returns 0 when nothing is unread', async () => {
      const qb = createQbMock({ getMany: [] });
      notificationRepo.createQueryBuilder.mockReturnValue(qb as never);

      await expect(service.markAllRead('user-1')).resolves.toBe(0);
    });

    it('inserts read rows for unread notifications', async () => {
      const qb = createQbMock({ getMany: [{ id: 'n1' }, { id: 'n2' }] });
      notificationRepo.createQueryBuilder.mockReturnValue(qb as never);
      const insertQb = createQbMock();
      readRepo.createQueryBuilder.mockReturnValue(insertQb as never);

      await expect(service.markAllRead('user-1')).resolves.toBe(2);
      expect(insertQb.execute).toHaveBeenCalled();
    });
  });

  describe('createNotification', () => {
    it('nulls userId for broadcasts', async () => {
      (notificationRepo.create as jest.Mock).mockImplementation(
        (v: unknown) => v as NotificationEntity,
      );
      (notificationRepo.save as jest.Mock).mockImplementation(
        async (v: unknown) => v as NotificationEntity,
      );

      const result = await service.createNotification({
        title: 'T',
        body: 'B',
      });

      expect(result.target).toBe(NotificationTarget.BROADCAST);
      expect(result.userId).toBeNull();
    });

    it('keeps userId for user-targeted notifications', async () => {
      (notificationRepo.create as jest.Mock).mockImplementation(
        (v: unknown) => v as NotificationEntity,
      );
      (notificationRepo.save as jest.Mock).mockImplementation(
        async (v: unknown) => v as NotificationEntity,
      );

      const result = await service.createNotification({
        target: NotificationTarget.USER,
        userId: 'user-9',
        title: 'T',
        body: 'B',
      });

      expect(result.userId).toBe('user-9');
    });
  });

  describe('markUnread', () => {
    it('deletes the read row when the notification is in scope', async () => {
      const scopeQb = createQbMock({ getExists: true });
      notificationRepo.createQueryBuilder.mockReturnValue(scopeQb as never);

      await service.markUnread('user-1', 'n1');

      expect(readRepo.delete).toHaveBeenCalledWith({
        notificationId: 'n1',
        userId: 'user-1',
      });
    });

    it('throws when the notification is not in scope', async () => {
      const scopeQb = createQbMock({ getExists: false });
      notificationRepo.createQueryBuilder.mockReturnValue(scopeQb as never);

      await expect(service.markUnread('user-1', 'n1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAllBanners', () => {
    it('returns all banners sorted by creation date descending', async () => {
      const banners = [
        { id: 'b1', createdAt: new Date('2026-01-02') },
        { id: 'b2', createdAt: new Date('2026-01-01') },
      ] as BannerEntity[];
      bannerRepo.find.mockResolvedValue(banners);

      const result = await service.findAllBanners();

      expect(result).toBe(banners);
      expect(bannerRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { createdAt: 'DESC' },
        }),
      );
    });
  });

  describe('findBannerById', () => {
    it('returns the banner when found', async () => {
      const banner = { id: 'b1' } as BannerEntity;
      bannerRepo.findOne.mockResolvedValue(banner);

      const result = await service.findBannerById('b1');

      expect(result).toBe(banner);
    });

    it('throws when not found', async () => {
      bannerRepo.findOne.mockResolvedValue(null);

      await expect(service.findBannerById('x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateBanner', () => {
    it('updates all provided fields', async () => {
      const existing = {
        id: 'b1',
        severity: 'INFO',
        title: 'Old',
        message: 'Old message',
        linkUrl: null,
        dismissible: false,
        active: false,
      } as BannerEntity;
      bannerRepo.findOne.mockResolvedValue(existing);
      (bannerRepo.save as jest.Mock).mockImplementation(
        async (v: unknown) => v,
      );

      const result = await service.updateBanner('b1', {
        title: 'New',
        message: 'New message',
        active: true,
      });

      expect(result.title).toBe('New');
      expect(result.message).toBe('New message');
      expect(result.active).toBe(true);
      expect(result.severity).toBe('INFO'); // unchanged
      expect(result.dismissible).toBe(false); // unchanged
    });

    it('throws when banner not found', async () => {
      bannerRepo.findOne.mockResolvedValue(null);

      await expect(service.updateBanner('x', { message: 'M' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeBanner', () => {
    it('soft removes when found', async () => {
      const banner = { id: 'b1' } as BannerEntity;
      bannerRepo.findOne.mockResolvedValue(banner);

      await service.removeBanner('b1');

      expect(bannerRepo.softRemove).toHaveBeenCalledWith(banner);
    });

    it('throws when not found', async () => {
      bannerRepo.findOne.mockResolvedValue(null);

      await expect(service.removeBanner('x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAllNotifications', () => {
    it('returns all notifications sorted by creation date descending', async () => {
      const notifications = [
        { id: 'n1', createdAt: new Date('2026-01-02') },
        { id: 'n2', createdAt: new Date('2026-01-01') },
      ] as NotificationEntity[];
      notificationRepo.find.mockResolvedValue(notifications);

      const result = await service.findAllNotifications();

      expect(result).toBe(notifications);
      expect(notificationRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { createdAt: 'DESC' },
        }),
      );
    });
  });

  describe('removeNotification', () => {
    it('throws when not found', async () => {
      notificationRepo.findOne.mockResolvedValue(null);
      await expect(service.removeNotification('x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft removes when found', async () => {
      const entity = { id: 'n1' } as NotificationEntity;
      notificationRepo.findOne.mockResolvedValue(entity);
      await service.removeNotification('n1');
      expect(notificationRepo.softRemove).toHaveBeenCalledWith(entity);
    });
  });
});
