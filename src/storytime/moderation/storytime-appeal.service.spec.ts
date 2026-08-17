import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationService } from '../../notification/notification.service';
import { AppealStatus } from '../enums/appeal-status.enum';
import { StorytimeModerationAction } from '../enums/storytime-moderation-action.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeModerationAppealEntity } from './entities/storytime-moderation-appeal.entity';
import { StorytimeAppealService } from './storytime-appeal.service';
import { StorytimeModerationTargetService } from './storytime-moderation-target.service';
import { StorytimeModerationService } from './storytime-moderation.service';

describe('StorytimeAppealService', () => {
  let service: StorytimeAppealService;
  let appealRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let targetService: { find: jest.Mock; describe: jest.Mock };
  let moderationService: { restore: jest.Mock; record: jest.Mock };
  let notificationService: { createNotification: jest.Mock };

  const writerId = 'writer-1';
  const strangerId = 'stranger-1';
  const adminId = 'admin-1';
  const storyId = 'story-1';
  const appealId = 'appeal-1';

  /** An appeal request. */
  const request = {
    targetType: StorytimeTargetType.STORY,
    targetId: storyId,
    body: 'The passage quoted is my own writing.',
  };

  /**
   * Builds the removed content being appealed.
   *
   * @param status - The moderation status to report.
   * @param ownerUserId - Who owns it.
   * @returns The target.
   */
  const buildTarget = (
    status = StorytimeModerationStatus.REMOVED,
    ownerUserId = writerId,
  ) => ({
    content: { id: storyId, moderationStatus: status },
    ownerUserId,
    label: 'A Fine Story',
  });

  /**
   * Builds an appeal.
   *
   * @param overrides - Fields to change.
   * @returns The appeal.
   */
  const buildAppeal = (
    overrides: Partial<StorytimeModerationAppealEntity> = {},
  ): StorytimeModerationAppealEntity =>
    Object.assign(new StorytimeModerationAppealEntity(), {
      id: appealId,
      targetType: StorytimeTargetType.STORY,
      targetId: storyId,
      appellantUserId: writerId,
      body: 'The passage quoted is my own writing.',
      status: AppealStatus.SUBMITTED,
      reviewedByUserId: null,
      reviewedAt: null,
      reviewNotes: null,
      ...overrides,
    });

  beforeEach(async () => {
    appealRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input =>
        Object.assign(new StorytimeModerationAppealEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
    };
    targetService = {
      find: jest.fn().mockResolvedValue(buildTarget()),
      describe: jest.fn().mockReturnValue('Story'),
    };
    moderationService = {
      restore: jest.fn().mockResolvedValue(undefined),
      record: jest.fn().mockResolvedValue(undefined),
    };
    notificationService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeAppealService,
        {
          provide: getRepositoryToken(StorytimeModerationAppealEntity),
          useValue: appealRepository,
        },
        {
          provide: StorytimeModerationTargetService,
          useValue: targetService,
        },
        { provide: StorytimeModerationService, useValue: moderationService },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get<StorytimeAppealService>(StorytimeAppealService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('appealing', () => {
    it('records what the creator has to say', async () => {
      const appeal = await service.create(request, writerId);

      expect(appeal.body).toBe('The passage quoted is my own writing.');
      expect(appeal.status).toBe(AppealStatus.SUBMITTED);
    });

    // An appeal from somebody who is not the author is not an appeal.
    it('refuses somebody else’s work', async () => {
      await expect(service.create(request, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses content that was never removed', async () => {
      targetService.find.mockResolvedValue(
        buildTarget(StorytimeModerationStatus.ACTIVE),
      );

      await expect(service.create(request, writerId)).rejects.toThrow(
        /has not been removed/,
      );
    });

    it('reports content that is not there', async () => {
      targetService.find.mockResolvedValue(null);

      await expect(service.create(request, writerId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a second appeal while the first is waiting', async () => {
      appealRepository.findOne.mockResolvedValue(buildAppeal());

      await expect(service.create(request, writerId)).rejects.toThrow(
        /still being looked at/,
      );
    });

    // A decision that can be reopened by asking again is not a decision.
    it.each([AppealStatus.UPHELD, AppealStatus.REJECTED])(
      'refuses a fresh appeal after one was %s',
      async status => {
        appealRepository.findOne.mockResolvedValue(buildAppeal({ status }));

        await expect(service.create(request, writerId)).rejects.toThrow(
          /already been appealed and decided/,
        );
      },
    );
  });

  describe('withdrawing', () => {
    beforeEach(() => {
      appealRepository.findOne.mockResolvedValue(buildAppeal());
    });

    it('takes an appeal back', async () => {
      const withdrawn = await service.withdraw(appealId, writerId);

      expect(withdrawn.status).toBe(AppealStatus.WITHDRAWN);
    });

    it('refuses to let anybody else withdraw it', async () => {
      await expect(service.withdraw(appealId, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses to withdraw one already decided', async () => {
      appealRepository.findOne.mockResolvedValue(
        buildAppeal({ status: AppealStatus.REJECTED }),
      );

      await expect(service.withdraw(appealId, writerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('reports an appeal that is not there', async () => {
      appealRepository.findOne.mockResolvedValue(null);

      await expect(service.withdraw(appealId, writerId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deciding', () => {
    beforeEach(() => {
      appealRepository.findOne.mockResolvedValue(buildAppeal());
    });

    it('upholds an appeal', async () => {
      const decided = await service.decide(
        appealId,
        { uphold: true, reviewNotes: 'You are right.' },
        adminId,
      );

      expect(decided.status).toBe(AppealStatus.UPHELD);
      expect(decided.reviewedByUserId).toBe(adminId);
      expect(decided.reviewedAt).toBeInstanceOf(Date);
    });

    // Agreeing with somebody and then leaving their work down is the failure
    // this workflow exists to prevent.
    it('restores the content as part of upholding it', async () => {
      await service.decide(appealId, { uphold: true }, adminId);

      expect(moderationService.restore).toHaveBeenCalledWith(
        expect.objectContaining({
          targetType: StorytimeTargetType.STORY,
          targetId: storyId,
        }),
        adminId,
      );
    });

    it('rejects an appeal without restoring anything', async () => {
      const decided = await service.decide(
        appealId,
        { uphold: false, reviewNotes: 'The removal stands.' },
        adminId,
      );

      expect(decided.status).toBe(AppealStatus.REJECTED);
      expect(moderationService.restore).not.toHaveBeenCalled();
    });

    it.each([
      [true, StorytimeModerationAction.APPEAL_UPHELD],
      [false, StorytimeModerationAction.APPEAL_REJECTED],
    ])('records the decision in the history', async (uphold, action) => {
      await service.decide(appealId, { uphold }, adminId);

      expect(moderationService.record).toHaveBeenCalledWith(
        StorytimeTargetType.STORY,
        storyId,
        action,
        adminId,
        null,
        null,
      );
    });

    it('tells the creator what was decided', async () => {
      await service.decide(appealId, { uphold: true }, adminId);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: writerId,
          title: 'Your appeal was upheld',
        }),
      );
    });

    it('passes the administrator’s words on with a rejection', async () => {
      await service.decide(
        appealId,
        { uphold: false, reviewNotes: 'The passage is not yours.' },
        adminId,
      );

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('The passage is not yours.'),
        }),
      );
    });

    it.each([
      ['an Error', new Error('mail is down')],
      ['a non-Error', 'mail is down'],
    ])(
      'still decides when the notification fails with %s',
      async (_name, failure) => {
        notificationService.createNotification.mockRejectedValue(failure);

        await expect(
          service.decide(appealId, { uphold: true }, adminId),
        ).resolves.toBeDefined();
      },
    );

    it.each([
      AppealStatus.UPHELD,
      AppealStatus.REJECTED,
      AppealStatus.WITHDRAWN,
    ])('refuses to decide an appeal already %s', async status => {
      appealRepository.findOne.mockResolvedValue(buildAppeal({ status }));

      await expect(
        service.decide(appealId, { uphold: true }, adminId),
      ).rejects.toThrow(/already been answered or withdrawn/);
    });

    it('reports an appeal that is not there', async () => {
      appealRepository.findOne.mockResolvedValue(null);

      await expect(
        service.decide(appealId, { uphold: true }, adminId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listing', () => {
    it('lists a creator’s own appeals, most recent first', async () => {
      await service.findMine(writerId);

      expect(appealRepository.find).toHaveBeenCalledWith({
        where: { appellantUserId: writerId },
        order: { createdAt: 'DESC' },
      });
    });

    it('lists the queue oldest first', async () => {
      await service.findForAdmin();

      expect(appealRepository.find).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'ASC' },
      });
    });

    it('filters the queue to one state', async () => {
      await service.findForAdmin(AppealStatus.SUBMITTED);

      expect(appealRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: AppealStatus.SUBMITTED },
        }),
      );
    });
  });
});
