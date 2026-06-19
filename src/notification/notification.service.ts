import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateBannerDto } from './dto/create-banner.dto';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { InboxQueryDto } from './dto/inbox-query.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { BannerEntity } from './entities/banner.entity';
import { NotificationReadEntity } from './entities/notification-read.entity';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationTarget } from './enums/notification-target.enum';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface InboxItem extends NotificationEntity {
  isRead: boolean;
  readAt: Date | null;
}

export interface PaginatedInbox {
  items: InboxItem[];
  total: number;
  page: number;
  pageSize: number;
  unreadCount: number;
}

@Injectable()
export class NotificationService {
  /**
   * Creates an instance of NotificationService.
   *
   * @param bannerRepository - The banner repository.
   * @param notificationRepository - The notification repository.
   * @param notificationReadRepository - The per-user read-state repository.
   */
  constructor(
    @InjectRepository(BannerEntity)
    private readonly bannerRepository: Repository<BannerEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    @InjectRepository(NotificationReadEntity)
    private readonly notificationReadRepository: Repository<NotificationReadEntity>,
  ) {}

  // ----- Banners (public read) -----

  /**
   * Returns the banners that are currently active and within their window.
   *
   * @returns The active banners, newest first.
   */
  async findActiveBanners(): Promise<BannerEntity[]> {
    const now = new Date();
    return this.bannerRepository
      .createQueryBuilder('b')
      .where('b.active = :active', { active: true })
      .andWhere('(b."startsAt" IS NULL OR b."startsAt" <= :now)', { now })
      .andWhere('(b."endsAt" IS NULL OR b."endsAt" >= :now)', { now })
      .orderBy('b."createdAt"', 'DESC')
      .getMany();
  }

  // ----- Banners (admin) -----

  /**
   * Lists all banners (admin), newest first.
   *
   * @returns All banners.
   */
  findAllBanners(): Promise<BannerEntity[]> {
    return this.bannerRepository.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Finds a banner by ID.
   *
   * @param id - The banner ID.
   * @returns The banner.
   * @throws NotFoundException when not found.
   */
  async findBannerById(id: string): Promise<BannerEntity> {
    const banner = await this.bannerRepository.findOne({ where: { id } });
    if (!banner) {
      throw new NotFoundException('Banner not found');
    }
    return banner;
  }

  /**
   * Creates a banner.
   *
   * @param dto - The banner data.
   * @returns The created banner.
   */
  createBanner(dto: CreateBannerDto): Promise<BannerEntity> {
    const banner = this.bannerRepository.create({
      severity: dto.severity,
      title: dto.title ?? null,
      message: dto.message,
      linkUrl: dto.linkUrl ?? null,
      linkLabel: dto.linkLabel ?? null,
      dismissible: dto.dismissible ?? true,
      active: dto.active ?? true,
      startsAt: dto.startsAt ?? null,
      endsAt: dto.endsAt ?? null,
    });
    return this.bannerRepository.save(banner);
  }

  /**
   * Updates a banner.
   *
   * @param id - The banner ID.
   * @param dto - The partial update.
   * @returns The updated banner.
   * @throws NotFoundException when not found.
   */
  async updateBanner(id: string, dto: UpdateBannerDto): Promise<BannerEntity> {
    const banner = await this.findBannerById(id);
    if (dto.severity !== undefined) banner.severity = dto.severity;
    if (dto.title !== undefined) banner.title = dto.title ?? null;
    if (dto.message !== undefined) banner.message = dto.message;
    if (dto.linkUrl !== undefined) banner.linkUrl = dto.linkUrl ?? null;
    if (dto.linkLabel !== undefined) banner.linkLabel = dto.linkLabel ?? null;
    if (dto.dismissible !== undefined) banner.dismissible = dto.dismissible;
    if (dto.active !== undefined) banner.active = dto.active;
    if (dto.startsAt !== undefined) banner.startsAt = dto.startsAt ?? null;
    if (dto.endsAt !== undefined) banner.endsAt = dto.endsAt ?? null;
    return this.bannerRepository.save(banner);
  }

  /**
   * Soft-deletes a banner.
   *
   * @param id - The banner ID.
   * @throws NotFoundException when not found.
   */
  async removeBanner(id: string): Promise<void> {
    const banner = await this.findBannerById(id);
    await this.bannerRepository.softRemove(banner);
  }

  // ----- Inbox notifications (user) -----

  /**
   * Returns a user's inbox: broadcast notifications plus notifications targeted
   * at them, annotated with per-user read state.
   *
   * @param userId - The authenticated user's ID.
   * @param query - Pagination and unread filter.
   * @returns A page of inbox items plus the total unread count.
   */
  async getInbox(
    userId: string,
    query: InboxQueryDto,
  ): Promise<PaginatedInbox> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = this.clampPageSize(query.pageSize);

    const qb = this.scopedInboxQuery(userId)
      .addSelect('r."readAt"', 'r_readAt')
      .orderBy('n.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    if (query.unreadOnly) {
      qb.andWhere('r.id IS NULL');
    }

    const { entities, raw } = await qb.getRawAndEntities();
    const items: InboxItem[] = entities.map((notification, index) => {
      const readAt: Date | null = raw[index]?.r_readAt ?? null;
      return Object.assign(notification, {
        isRead: readAt !== null,
        readAt: readAt ? new Date(readAt) : null,
      });
    });

    const total = await this.countInbox(userId, query.unreadOnly ?? false);
    const unreadCount = await this.getUnreadCount(userId);

    return { items, total, page, pageSize, unreadCount };
  }

  /**
   * Counts unread notifications for a user.
   *
   * @param userId - The authenticated user's ID.
   * @returns The unread count.
   */
  getUnreadCount(userId: string): Promise<number> {
    return this.scopedInboxQuery(userId).andWhere('r.id IS NULL').getCount();
  }

  /**
   * Marks a single notification as read for a user (idempotent).
   *
   * @param userId - The authenticated user's ID.
   * @param notificationId - The notification ID.
   * @throws NotFoundException when the notification is not in the user's scope.
   */
  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.assertNotificationInScope(userId, notificationId);
    await this.notificationReadRepository
      .createQueryBuilder()
      .insert()
      .values({ notificationId, userId })
      .orIgnore()
      .execute();
  }

  /**
   * Marks a single notification as unread for a user (idempotent).
   *
   * @param userId - The authenticated user's ID.
   * @param notificationId - The notification ID.
   * @throws NotFoundException when the notification is not in the user's scope.
   */
  async markUnread(userId: string, notificationId: string): Promise<void> {
    await this.assertNotificationInScope(userId, notificationId);
    await this.notificationReadRepository.delete({ notificationId, userId });
  }

  /**
   * Marks every notification in a user's inbox as read.
   *
   * @param userId - The authenticated user's ID.
   * @returns The number of notifications newly marked as read.
   */
  async markAllRead(userId: string): Promise<number> {
    const unread = await this.scopedInboxQuery(userId)
      .andWhere('r.id IS NULL')
      .getMany();

    if (unread.length === 0) {
      return 0;
    }

    await this.notificationReadRepository
      .createQueryBuilder()
      .insert()
      .values(unread.map(n => ({ notificationId: n.id, userId })))
      .orIgnore()
      .execute();

    return unread.length;
  }

  // ----- Notifications (admin) -----

  /**
   * Creates a notification, either broadcast or targeted at a single user.
   *
   * @param dto - The notification data.
   * @returns The created notification.
   */
  createNotification(dto: CreateNotificationDto): Promise<NotificationEntity> {
    const target = dto.target ?? NotificationTarget.BROADCAST;
    const notification = this.notificationRepository.create({
      target,
      userId: target === NotificationTarget.USER ? (dto.userId ?? null) : null,
      severity: dto.severity,
      title: dto.title,
      body: dto.body,
      linkUrl: dto.linkUrl ?? null,
    });
    return this.notificationRepository.save(notification);
  }

  /**
   * Lists all notifications (admin), newest first.
   *
   * @returns All notifications.
   */
  findAllNotifications(): Promise<NotificationEntity[]> {
    return this.notificationRepository.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Soft-deletes a notification (admin).
   *
   * @param id - The notification ID.
   * @throws NotFoundException when not found.
   */
  async removeNotification(id: string): Promise<void> {
    const notification = await this.notificationRepository.findOne({
      where: { id },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    await this.notificationRepository.softRemove(notification);
  }

  // ----- Helpers -----

  /**
   * Builds a query selecting the notifications visible to a user, left-joined
   * to that user's read state (alias `r`).
   *
   * @param userId - The authenticated user's ID.
   * @returns A configured query builder.
   */
  private scopedInboxQuery(userId: string) {
    return this.notificationRepository
      .createQueryBuilder('n')
      .leftJoin(
        NotificationReadEntity,
        'r',
        'r."notificationId" = n.id AND r."userId" = :userId',
        { userId },
      )
      .where(
        '(n.target = :broadcast OR (n.target = :user AND n."userId" = :userId))',
        {
          broadcast: NotificationTarget.BROADCAST,
          user: NotificationTarget.USER,
          userId,
        },
      );
  }

  /**
   * Counts inbox notifications for a user, optionally only unread ones.
   *
   * @param userId - The authenticated user's ID.
   * @param unreadOnly - Whether to restrict to unread.
   * @returns The matching count.
   */
  private countInbox(userId: string, unreadOnly: boolean): Promise<number> {
    const qb = this.scopedInboxQuery(userId);
    if (unreadOnly) {
      qb.andWhere('r.id IS NULL');
    }
    return qb.getCount();
  }

  /**
   * Ensures a notification exists and is visible to the user.
   *
   * @param userId - The authenticated user's ID.
   * @param notificationId - The notification ID.
   * @throws NotFoundException when the notification is not in the user's scope.
   */
  private async assertNotificationInScope(
    userId: string,
    notificationId: string,
  ): Promise<void> {
    const exists = await this.scopedInboxQuery(userId)
      .andWhere('n.id = :notificationId', { notificationId })
      .getExists();

    if (!exists) {
      throw new NotFoundException('Notification not found');
    }
  }

  /**
   * Clamps a requested page size to the supported range.
   *
   * @param requested - The requested page size.
   * @returns A safe page size.
   */
  private clampPageSize(requested?: number): number {
    if (!requested || requested < 1) {
      return DEFAULT_PAGE_SIZE;
    }
    return Math.min(requested, MAX_PAGE_SIZE);
  }
}
