import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationService } from '../../notification/notification.service';
import { StorytimeModerationAction } from '../enums/storytime-moderation-action.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeReportReason } from '../enums/storytime-report-reason.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeModerationActionEntity } from './entities/storytime-moderation-action.entity';
import {
  ModeratableFields,
  ModeratedTarget,
  StorytimeModerationTargetService,
} from './storytime-moderation-target.service';
import { StorytimeModerationService } from './storytime-moderation.service';

describe('StorytimeModerationService', () => {
  let service: StorytimeModerationService;
  let actionRepository: { find: jest.Mock; create: jest.Mock; save: jest.Mock };
  let targetService: {
    find: jest.Mock;
    save: jest.Mock;
    describe: jest.Mock;
    isModeratable: jest.Mock;
  };
  let notificationService: { createNotification: jest.Mock };

  const adminId = 'admin-1';
  const storyId = 'story-1';

  /**
   * Builds the content an administrator is acting on.
   *
   * @param overrides - Moderation fields to change.
   * @returns The target.
   */
  const buildTarget = (
    overrides: Partial<ModeratableFields> = {},
  ): ModeratedTarget => ({
    content: {
      id: storyId,
      moderationStatus: StorytimeModerationStatus.ACTIVE,
      removedAt: null,
      removedByUserId: null,
      moderationReasonCode: null,
      moderationMessage: null,
      restoredAt: null,
      restoredByUserId: null,
      ...overrides,
    },
    ownerUserId: 'writer-1',
    label: 'A Fine Story',
  });

  /** A removal request. */
  const request = {
    targetType: StorytimeTargetType.STORY,
    targetId: storyId,
    reasonCode: StorytimeReportReason.HARASSMENT,
    message: 'This breaches the harassment policy.',
  };

  beforeEach(async () => {
    actionRepository = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn(input =>
        Object.assign(new StorytimeModerationActionEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
    };
    targetService = {
      find: jest.fn().mockResolvedValue(buildTarget()),
      save: jest.fn().mockResolvedValue(undefined),
      describe: jest.fn().mockReturnValue('Story'),
      isModeratable: jest.fn().mockReturnValue(true),
    };
    notificationService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeModerationService,
        {
          provide: getRepositoryToken(StorytimeModerationActionEntity),
          useValue: actionRepository,
        },
        {
          provide: StorytimeModerationTargetService,
          useValue: targetService,
        },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get<StorytimeModerationService>(
      StorytimeModerationService,
    );
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('removing', () => {
    it('takes the content out of public view', async () => {
      await service.remove(request, adminId);

      const saved = targetService.save.mock.calls[0][1] as ModeratableFields;

      expect(saved.moderationStatus).toBe(StorytimeModerationStatus.REMOVED);
      expect(saved.removedByUserId).toBe(adminId);
      expect(saved.removedAt).toBeInstanceOf(Date);
    });

    // Nobody can fix, or meaningfully appeal, a removal they have not been
    // given a reason for.
    it('records the reason and the message on the content itself', async () => {
      await service.remove(request, adminId);

      const saved = targetService.save.mock.calls[0][1] as ModeratableFields;

      expect(saved.moderationReasonCode).toBe(StorytimeReportReason.HARASSMENT);
      expect(saved.moderationMessage).toBe(
        'This breaches the harassment policy.',
      );
    });

    it('writes an audit entry', async () => {
      const entry = await service.remove(request, adminId);

      expect(entry.action).toBe(StorytimeModerationAction.REMOVED);
      expect(entry.actorUserId).toBe(adminId);
      expect(entry.targetId).toBe(storyId);
    });

    it('tells the creator, in the administrator’s own words', async () => {
      await service.remove(request, adminId);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'writer-1',
          body: expect.stringContaining('breaches the harassment policy'),
        }),
      );
    });

    // Removing something twice would write a second audit entry saying it
    // happened again, and overwrite the first removal's reason.
    it('refuses content that is already removed', async () => {
      targetService.find.mockResolvedValue(
        buildTarget({ moderationStatus: StorytimeModerationStatus.REMOVED }),
      );

      await expect(service.remove(request, adminId)).rejects.toThrow(
        /already been removed/,
      );
    });

    it('reports content that is not there', async () => {
      targetService.find.mockResolvedValue(null);

      await expect(service.remove(request, adminId)).rejects.toThrow(
        NotFoundException,
      );
    });

    // The record of what an administrator did is the part that must not be
    // lost to a mail server.
    it.each([
      ['an Error', new Error('mail is down')],
      ['a non-Error', 'mail is down'],
    ])(
      'still removes when the notification fails with %s',
      async (_name, failure) => {
        notificationService.createNotification.mockRejectedValue(failure);

        await expect(service.remove(request, adminId)).resolves.toBeDefined();
        expect(actionRepository.save).toHaveBeenCalled();
      },
    );
  });

  describe('restoring', () => {
    beforeEach(() => {
      targetService.find.mockResolvedValue(
        buildTarget({
          moderationStatus: StorytimeModerationStatus.REMOVED,
          removedAt: new Date('2026-06-01T00:00:00.000Z'),
          removedByUserId: adminId,
          moderationMessage: 'This breaches the harassment policy.',
        }),
      );
    });

    it('puts the content back', async () => {
      await service.restore(request, adminId);

      const saved = targetService.save.mock.calls[0][1] as ModeratableFields;

      expect(saved.moderationStatus).toBe(StorytimeModerationStatus.ACTIVE);
      expect(saved.restoredByUserId).toBe(adminId);
      expect(saved.restoredAt).toBeInstanceOf(Date);
    });

    // What happened to a Story is part of its history: a restore that erased
    // the removal would leave a creator unable to show what they answered.
    it('keeps what was said when it was removed', async () => {
      await service.restore(request, adminId);

      const saved = targetService.save.mock.calls[0][1] as ModeratableFields;

      expect(saved.moderationMessage).toBe(
        'This breaches the harassment policy.',
      );
      expect(saved.removedAt).toBeInstanceOf(Date);
    });

    it('writes an audit entry', async () => {
      const entry = await service.restore(request, adminId);

      expect(entry.action).toBe(StorytimeModerationAction.RESTORED);
    });

    it('tells the creator', async () => {
      await service.restore(request, adminId);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'writer-1' }),
      );
    });

    it('refuses content that was never removed', async () => {
      targetService.find.mockResolvedValue(buildTarget());

      await expect(service.restore(request, adminId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('reports content that is not there', async () => {
      targetService.find.mockResolvedValue(null);

      await expect(service.restore(request, adminId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('the audit trail', () => {
    it('reads a piece of content’s history, most recent first', async () => {
      await service.findHistory(StorytimeTargetType.STORY, storyId);

      expect(actionRepository.find).toHaveBeenCalledWith({
        where: { targetType: StorytimeTargetType.STORY, targetId: storyId },
        order: { createdAt: 'DESC' },
      });
    });

    it('records an act with no reason or message', async () => {
      const entry = await service.record(
        StorytimeTargetType.ARC,
        'arc-1',
        StorytimeModerationAction.REPORT_RESOLVED,
        adminId,
      );

      expect(entry.reasonCode).toBeNull();
      expect(entry.message).toBeNull();
    });
  });

  // A message is required on removal, but an administrator restoring something
  // may have nothing to add.
  it('falls back to a plain notification when there is no message', async () => {
    targetService.find.mockResolvedValue(
      buildTarget({ moderationStatus: StorytimeModerationStatus.REMOVED }),
    );

    await service.restore({ ...request, message: '' }, adminId);

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('actioned by an administrator'),
      }),
    );
  });
});
