import { ConflictException, Logger, NotFoundException } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { IsNull, Repository } from 'typeorm';

import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';
import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { ImageIngressService } from 'src/file-assets/services/image-ingress.service';
import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';
import { RegistryService } from 'src/registry/registry.service';

import { LOG_PICTURE_SPEC, LogEntryType } from './captains-log.constants';
import { CaptainsLogService } from './captains-log.service';
import { LogEntryEntity } from './entities/log-entry.entity';

type AsyncMock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

/**
 * Builds an entry as the database would hand it back.
 *
 * @param overrides - Whatever the case is about.
 * @returns The entry.
 */
const entry = (overrides: Partial<LogEntryEntity> = {}): LogEntryEntity =>
  ({
    id: 'entry-1',
    userId: 'user-1',
    type: LogEntryType.CAPTAIN,
    headline: null,
    body: 'We reached the Azure Nebula.',
    stardate: 104502.57,
    pictureId: null,
    pictureAlt: null,
    createdAt: new Date('2026-11-24T10:30:00Z'),
    updatedAt: new Date('2026-11-24T10:30:00Z'),
    editedAt: null,
    removedAt: null,
    removedByUserId: null,
    removedReason: null,
    ...overrides,
  }) as LogEntryEntity;

/** The upload a member sends. */
const upload = {
  altText: 'The bridge at red alert',
  file: { originalname: 'bridge.jpg' } as Express.Multer.File,
};

describe('CaptainsLogService (sc-1450)', () => {
  let repository: {
    findAndCount: AsyncMock;
    findOneBy: AsyncMock;
    exists: AsyncMock;
    create: jest.Mock<(row: unknown) => unknown>;
    save: AsyncMock;
    delete: AsyncMock;
    manager: { transaction: AsyncMock; query: AsyncMock };
  };
  let transactionManager: { save: AsyncMock; insert: AsyncMock };
  let accept: AsyncMock;
  let withdrawSlot: AsyncMock;
  let findVisibleMemberId: AsyncMock;
  let createNotification: AsyncMock;
  let service: CaptainsLogService;

  beforeEach(() => {
    transactionManager = {
      save: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockImplementation((_entity, row) => Promise.resolve(row)),
      insert: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(undefined),
    };
    repository = {
      findAndCount: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      findOneBy: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      exists: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      create: jest.fn((row: unknown) => row),
      save: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockImplementation(row =>
          Promise.resolve({ id: 'entry-1', ...(row as object) }),
        ),
      delete: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(undefined),
      manager: {
        transaction: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockImplementation(work =>
            (work as (manager: unknown) => Promise<unknown>)(
              transactionManager,
            ),
          ),
        query: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue(undefined),
      },
    };
    accept = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ assetId: 'asset-1', state: 'QUARANTINED' });
    withdrawSlot = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(undefined);
    findVisibleMemberId = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue('user-1');
    createNotification = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(undefined);

    service = new CaptainsLogService(
      repository as unknown as Repository<LogEntryEntity>,
      { accept } as unknown as ImageIngressService,
      { withdrawSlot } as unknown as AssetWithdrawalService,
      { findVisibleMemberId } as unknown as RegistryService,
      { createNotification } as unknown as NotificationService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('list', () => {
    it('lists the member’s own entries newest first, twenty a page by default', async () => {
      repository.findAndCount.mockResolvedValue([[entry()], 1]);

      const page = await service.list('user-1', {});

      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(page).toEqual(
        expect.objectContaining({ total: 1, page: 1, pageSize: 20 }),
      );
      expect(page.items[0].headline).toBe("Captain's Log stardate 104502.6");
    });

    it('lists only one type, a page at a time, when asked', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.list('user-1', {
        type: LogEntryType.PERSONAL,
        page: 3,
        pageSize: 5,
      });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', type: LogEntryType.PERSONAL },
          skip: 10,
          take: 5,
        }),
      );
    });
  });

  describe('get', () => {
    it('reads one of the member’s own entries', async () => {
      repository.findOneBy.mockResolvedValue(entry({ headline: 'Arrival' }));

      await expect(service.get('user-1', 'entry-1')).resolves.toEqual(
        expect.objectContaining({
          headline: 'Arrival',
          customHeadline: 'Arrival',
        }),
      );
    });

    it('does not find somebody else’s entry', async () => {
      repository.findOneBy.mockResolvedValue(entry({ userId: 'user-2' }));

      await expect(service.get('user-1', 'entry-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not find an entry that is not there', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.get('user-1', 'entry-1')).rejects.toThrow(
        'Log entry not found',
      );
    });
  });

  describe('create', () => {
    it('stamps a new entry with the stardate and moment it was written', async () => {
      jest.useFakeTimers({ now: new Date('2026-05-25T00:00:00Z') });

      const view = await service.create('user-1', {
        type: LogEntryType.PERSONAL,
        body: 'A quiet watch.',
      });

      expect(repository.create).toHaveBeenCalledWith({
        userId: 'user-1',
        type: LogEntryType.PERSONAL,
        headline: null,
        body: 'A quiet watch.',
        stardate: 104000,
        createdAt: new Date('2026-05-25T00:00:00Z'),
      });
      expect(view.headline).toBe('Personal Log stardate 104000.0');
    });

    it('keeps a headline the author gave, and treats a blank one as none', async () => {
      await service.create('user-1', {
        type: LogEntryType.CAPTAIN,
        headline: 'First contact',
        body: 'Hailing frequencies open.',
      });
      await service.create('user-1', {
        type: LogEntryType.CAPTAIN,
        headline: '',
        body: 'Hailing frequencies open.',
      });

      expect(repository.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ headline: 'First contact' }),
      );
      expect(repository.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ headline: null }),
      );
    });
  });

  describe('update', () => {
    it('changes what it is given, marks the entry edited and keeps its stardate', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-25T09:00:00Z') });
      repository.findOneBy.mockResolvedValue(entry({ headline: 'Old' }));

      const view = await service.update('user-1', 'entry-1', {
        headline: 'New',
        body: 'Revised.',
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          headline: 'New',
          body: 'Revised.',
          stardate: 104502.57,
          type: LogEntryType.CAPTAIN,
          editedAt: new Date('2026-11-25T09:00:00Z'),
        }),
      );
      expect(view.editedAt).toEqual(new Date('2026-11-25T09:00:00Z'));
      expect(repository.manager.query).not.toHaveBeenCalled();
    });

    it('goes back to the stardate headline when the headline is cleared', async () => {
      repository.findOneBy.mockResolvedValue(entry({ headline: 'Old' }));

      const view = await service.update('user-1', 'entry-1', { headline: '' });

      expect(view.customHeadline).toBeNull();
      expect(view.headline).toBe("Captain's Log stardate 104502.6");
      expect(view.body).toBe('We reached the Azure Nebula.');
    });

    it('carries the pictures with the entry when it becomes Personal', async () => {
      repository.findOneBy.mockResolvedValue(entry());

      await service.update('user-1', 'entry-1', {
        type: LogEntryType.PERSONAL,
      });

      expect(repository.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "sto_info_app"."file_asset"'),
        [FileAssetAudience.OWNER, FileAssetSubject.LOG_ENTRY, 'entry-1'],
      );
    });

    it('makes the pictures public when the entry becomes a Captain’s one', async () => {
      repository.findOneBy.mockResolvedValue(
        entry({ type: LogEntryType.PERSONAL }),
      );

      await service.update('user-1', 'entry-1', {
        type: LogEntryType.CAPTAIN,
      });

      expect(repository.manager.query).toHaveBeenCalledWith(
        expect.any(String),
        [FileAssetAudience.PUBLIC, FileAssetSubject.LOG_ENTRY, 'entry-1'],
      );
    });

    it('leaves the pictures alone when the type it is given is the one it has', async () => {
      repository.findOneBy.mockResolvedValue(entry());

      await service.update('user-1', 'entry-1', {
        type: LogEntryType.CAPTAIN,
      });

      expect(repository.manager.query).not.toHaveBeenCalled();
    });

    it('refuses to change an entry moderators removed', async () => {
      repository.findOneBy.mockResolvedValue(
        entry({ removedAt: new Date(), removedReason: 'Spoilers' }),
      );

      await expect(
        service.update('user-1', 'entry-1', { body: 'Again.' }),
      ).rejects.toThrow(ConflictException);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the entry for good and takes its picture down', async () => {
      repository.findOneBy.mockResolvedValue(
        entry({ pictureId: 'picture-1', pictureAlt: 'The nebula' }),
      );

      await service.remove('user-1', 'entry-1');

      expect(repository.delete).toHaveBeenCalledWith({ id: 'entry-1' });
      expect(withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.LOG_ENTRY,
        'entry-1',
        FileAssetSlot.PICTURE,
        'picture-1',
        'Its Log entry was deleted',
      );
    });

    it('withdraws nothing when the entry had no picture', async () => {
      repository.findOneBy.mockResolvedValue(entry());

      await service.remove('user-1', 'entry-1');

      expect(withdrawSlot).not.toHaveBeenCalled();
    });

    it('deletes nobody else’s entry', async () => {
      repository.findOneBy.mockResolvedValue(entry({ userId: 'user-2' }));

      await expect(service.remove('user-1', 'entry-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });

  describe('setPicture', () => {
    it('sends a Captain’s entry’s picture to be scanned as a public one', async () => {
      repository.findOneBy.mockResolvedValue(entry());

      await expect(
        service.setPicture('user-1', 'entry-1', upload),
      ).resolves.toEqual({ assetId: 'asset-1', state: 'QUARANTINED' });

      expect(accept).toHaveBeenCalledWith(
        expect.objectContaining({
          spec: LOG_PICTURE_SPEC,
          userId: 'user-1',
          kind: FileAssetKind.LOG_IMAGE,
          audience: FileAssetAudience.PUBLIC,
          subject: FileAssetSubject.LOG_ENTRY,
          subjectId: 'entry-1',
          slot: FileAssetSlot.PICTURE,
          entityTag: 'log-picture',
          entityId: 'entry-1',
          sizeLimitLabel: 'Log pictures',
          file: upload.file,
          feature: { altText: 'The bridge at red alert' },
        }),
      );
    });

    it('sends a Personal entry’s picture as one only its owner may see', async () => {
      repository.findOneBy.mockResolvedValue(
        entry({ type: LogEntryType.PERSONAL }),
      );

      await service.setPicture('user-1', 'entry-1', upload);

      expect(accept).toHaveBeenCalledWith(
        expect.objectContaining({ audience: FileAssetAudience.OWNER }),
      );
    });

    it('takes no picture for an entry moderators removed', async () => {
      repository.findOneBy.mockResolvedValue(
        entry({ removedAt: new Date(), removedReason: 'Spoilers' }),
      );

      await expect(
        service.setPicture('user-1', 'entry-1', upload),
      ).rejects.toThrow(ConflictException);
      expect(accept).not.toHaveBeenCalled();
    });
  });

  describe('clearPicture', () => {
    it('empties the columns before taking the picture down', async () => {
      repository.findOneBy.mockResolvedValue(
        entry({ pictureId: 'picture-1', pictureAlt: 'The nebula' }),
      );

      await service.clearPicture('user-1', 'entry-1');

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ pictureId: null, pictureAlt: null }),
      );
      expect(withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.LOG_ENTRY,
        'entry-1',
        FileAssetSlot.PICTURE,
        'picture-1',
        'Removed from its entry',
      );
    });

    it('says so when there is no picture to remove', async () => {
      repository.findOneBy.mockResolvedValue(entry());

      await expect(service.clearPicture('user-1', 'entry-1')).rejects.toThrow(
        'This entry has no picture to remove.',
      );
    });
  });

  describe('listPublic', () => {
    it('lists only the Captain’s entries moderators have not removed, of a profile that may be seen', async () => {
      repository.findAndCount.mockResolvedValue([[entry()], 1]);

      const page = await service.listPublic('captain.picard', 'viewer-1', {
        page: 2,
      });

      expect(findVisibleMemberId).toHaveBeenCalledWith(
        'captain.picard',
        'viewer-1',
      );
      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            type: LogEntryType.CAPTAIN,
            removedAt: IsNull(),
          },
          skip: 20,
          take: 20,
        }),
      );
      expect(page.items[0]).not.toHaveProperty('type');
      expect(page.items[0]).not.toHaveProperty('removedReason');
    });

    it('finds nothing when the profile may not be seen', async () => {
      findVisibleMemberId.mockRejectedValue(
        new NotFoundException('Member not found'),
      );

      await expect(service.listPublic('hidden', null, {})).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.findAndCount).not.toHaveBeenCalled();
    });
  });

  describe('isReportable', () => {
    it('asks for a Captain’s entry of that member still on show', async () => {
      repository.exists.mockResolvedValue(true);

      await expect(service.isReportable('user-1', 'entry-1')).resolves.toBe(
        true,
      );
      expect(repository.exists).toHaveBeenCalledWith({
        where: {
          id: 'entry-1',
          userId: 'user-1',
          type: LogEntryType.CAPTAIN,
          removedAt: IsNull(),
        },
      });
    });
  });

  describe('getForAdmin', () => {
    it('reads any entry, with its author', async () => {
      repository.findOneBy.mockResolvedValue(
        entry({ type: LogEntryType.PERSONAL, userId: 'user-9' }),
      );

      await expect(service.getForAdmin('entry-1')).resolves.toEqual(
        expect.objectContaining({ userId: 'user-9' }),
      );
    });
  });

  describe('removeForAdmin', () => {
    it('marks the entry removed, logs it, hides its pictures and tells the author', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-25T08:00:00Z') });
      repository.findOneBy.mockResolvedValue(entry({ headline: 'Arrival' }));

      const view = await service.removeForAdmin(
        'admin-1',
        'entry-1',
        'Spoilers for the new episode',
      );

      expect(transactionManager.save).toHaveBeenCalledWith(
        LogEntryEntity,
        expect.objectContaining({
          removedAt: new Date('2026-11-25T08:00:00Z'),
          removedByUserId: 'admin-1',
          removedReason: 'Spoilers for the new episode',
        }),
      );
      expect(transactionManager.insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.LOG_ENTRY_REMOVED,
          actorUserId: 'admin-1',
          targetUserId: 'user-1',
          subjectKind: 'LOG_ENTRY',
          subjectId: 'entry-1',
          reason: 'Spoilers for the new episode',
          detail: { type: LogEntryType.CAPTAIN },
        }),
      );
      expect(repository.manager.query).toHaveBeenCalledWith(
        expect.any(String),
        [FileAssetAudience.OWNER, FileAssetSubject.LOG_ENTRY, 'entry-1'],
      );
      expect(createNotification).toHaveBeenCalledWith({
        target: NotificationTarget.USER,
        userId: 'user-1',
        severity: NotificationSeverity.WARNING,
        title: "A Captain's Log entry was removed",
        body: 'Moderators removed "Arrival" from your profile: Spoilers for the new episode',
        linkUrl: '/dashboard/log',
      });
      expect(view.removedReason).toBe('Spoilers for the new episode');
    });

    it('keeps the removal when the notice cannot be sent', async () => {
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      repository.findOneBy.mockResolvedValue(entry());
      createNotification.mockRejectedValueOnce(new Error('down'));
      await service.removeForAdmin('admin-1', 'entry-1', 'Spoilers');

      createNotification.mockRejectedValueOnce('down');
      repository.findOneBy.mockResolvedValue(entry());
      await expect(
        service.removeForAdmin('admin-1', 'entry-1', 'Spoilers'),
      ).resolves.toEqual(
        expect.objectContaining({ removedReason: 'Spoilers' }),
      );

      expect(logged).toHaveBeenNthCalledWith(
        1,
        'Failed to notify user-1 of a Log entry removal',
        expect.stringContaining('down'),
      );
      expect(logged).toHaveBeenNthCalledWith(
        2,
        'Failed to notify user-1 of a Log entry removal',
        'down',
      );
    });

    it('refuses to remove an entry twice', async () => {
      repository.findOneBy.mockResolvedValue(
        entry({ removedAt: new Date(), removedReason: 'Spoilers' }),
      );

      await expect(
        service.removeForAdmin('admin-1', 'entry-1', 'Again'),
      ).rejects.toThrow(
        'This entry was removed by moderators and can no longer be changed.',
      );
      expect(repository.manager.transaction).not.toHaveBeenCalled();
    });
  });
});
