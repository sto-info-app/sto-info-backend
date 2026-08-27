import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationService } from '../../notification/notification.service';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { CollaborationInvitationStatus } from '../enums/collaboration-invitation-status.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeStoryCollaboratorEntity } from './entities/storytime-story-collaborator.entity';
import { StorytimeCollaboratorService } from './storytime-collaborator.service';

describe('StorytimeCollaboratorService', () => {
  let service: StorytimeCollaboratorService;
  let collaboratorRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let storyService: {
    findEditableOrFail: jest.Mock;
    findAccessibleOrFail: jest.Mock;
  };
  let notificationService: { createNotification: jest.Mock };

  const ownerId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const memberId = 'e6d3a1b2-0000-4000-8000-000000000002';
  const strangerId = 'e6d3a1b2-0000-4000-8000-000000000003';
  const storyId = 'e6d3a1b2-0000-4000-8000-0000000000aa';
  const collaboratorId = 'e6d3a1b2-0000-4000-8000-0000000000dd';

  /**
   * Builds a collaboration.
   *
   * @param overrides - Fields to change.
   * @returns The collaboration entity.
   */
  const buildCollaborator = (
    overrides: Partial<StorytimeStoryCollaboratorEntity> = {},
  ): StorytimeStoryCollaboratorEntity =>
    Object.assign(new StorytimeStoryCollaboratorEntity(), {
      id: collaboratorId,
      storyId,
      userId: memberId,
      canEditStory: false,
      canManageChapters: false,
      canManageCharacters: false,
      canManageCrew: false,
      canManageCollaborators: false,
      canPublish: false,
      invitationStatus: CollaborationInvitationStatus.INVITED,
      invitedByUserId: ownerId,
      invitedAt: new Date(),
      acceptedAt: null,
      revokedAt: null,
      ...overrides,
    });

  beforeEach(async () => {
    collaboratorRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(() => new StorytimeStoryCollaboratorEntity()),
      save: jest.fn(input => Promise.resolve(input)),
    };

    storyService = {
      findEditableOrFail: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeStoryEntity(), {
          id: storyId,
          ownerUserId: ownerId,
          title: 'The Long Way Home',
        }),
      ),
      findAccessibleOrFail: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeStoryEntity(), {
          id: storyId,
          ownerUserId: ownerId,
        }),
      ),
    };

    notificationService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeCollaboratorService,
        {
          provide: getRepositoryToken(StorytimeStoryCollaboratorEntity),
          useValue: collaboratorRepository,
        },
        { provide: StorytimeStoryService, useValue: storyService },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get<StorytimeCollaboratorService>(
      StorytimeCollaboratorService,
    );
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

  describe('inviting', () => {
    it('invites somebody', async () => {
      const invited = await service.invite(
        storyId,
        { userId: memberId, canManageChapters: true },
        ownerId,
      );

      expect(invited.userId).toBe(memberId);
      expect(invited.canManageChapters).toBe(true);
      expect(invited.invitedByUserId).toBe(ownerId);
    });

    // An invitation grants nothing until it is taken up: access is something a
    // person accepts, never something an owner assigns.
    it('grants nothing until it is accepted', async () => {
      const invited = await service.invite(
        storyId,
        { userId: memberId, canManageChapters: true },
        ownerId,
      );

      expect(invited.invitationStatus).toBe(
        CollaborationInvitationStatus.INVITED,
      );
      expect(invited.acceptedAt).toBeNull();
    });

    it('needs permission to manage collaborators', async () => {
      await service.invite(storyId, { userId: memberId }, ownerId);

      expect(storyService.findEditableOrFail).toHaveBeenCalledWith(
        storyId,
        ownerId,
        StoryCapability.MANAGE_COLLABORATORS,
      );
    });

    it('refuses when the caller may not manage collaborators', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.invite(storyId, { userId: memberId }, strangerId),
      ).rejects.toThrow(ForbiddenException);
    });

    // Publishing is not delegable, whatever the request says.
    it('never grants publishing', async () => {
      const invited = await service.invite(
        storyId,
        { userId: memberId, canPublish: true },
        ownerId,
      );

      expect(invited.canPublish).toBe(false);
    });

    it('grants nothing by default', async () => {
      const invited = await service.invite(
        storyId,
        { userId: memberId },
        ownerId,
      );

      expect(invited.canEditStory).toBe(false);
      expect(invited.canManageChapters).toBe(false);
      expect(invited.canManageCharacters).toBe(false);
      expect(invited.canManageCrew).toBe(false);
      expect(invited.canManageCollaborators).toBe(false);
    });

    it('refuses to invite the owner', async () => {
      await expect(
        service.invite(storyId, { userId: ownerId }, ownerId),
      ).rejects.toThrow(/already able to do everything/);
    });

    it('refuses to invite somebody twice', async () => {
      collaboratorRepository.findOne.mockResolvedValue(buildCollaborator());

      await expect(
        service.invite(storyId, { userId: memberId }, ownerId),
      ).rejects.toThrow(/already been invited/);
    });

    it('refuses to invite an existing collaborator', async () => {
      collaboratorRepository.findOne.mockResolvedValue(
        buildCollaborator({
          invitationStatus: CollaborationInvitationStatus.ACCEPTED,
        }),
      );

      await expect(
        service.invite(storyId, { userId: memberId }, ownerId),
      ).rejects.toThrow(/already been invited/);
    });

    // Falling out and making up is an ordinary thing and should not need an
    // administrator to undo the unique constraint.
    it.each([
      CollaborationInvitationStatus.DECLINED,
      CollaborationInvitationStatus.REVOKED,
    ])('re-invites somebody who previously %s', async status => {
      collaboratorRepository.findOne.mockResolvedValue(
        buildCollaborator({ invitationStatus: status, revokedAt: new Date() }),
      );

      const invited = await service.invite(
        storyId,
        { userId: memberId },
        ownerId,
      );

      expect(invited.invitationStatus).toBe(
        CollaborationInvitationStatus.INVITED,
      );
      expect(invited.revokedAt).toBeNull();
      expect(collaboratorRepository.create).not.toHaveBeenCalled();
    });

    it('tells the invited member', async () => {
      await service.invite(storyId, { userId: memberId }, ownerId);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: memberId,
          body: expect.stringContaining('The Long Way Home'),
        }),
      );
    });

    // The invitation still shows up in their list, so a failed announcement is
    // recoverable — failing the request would leave the owner thinking nothing
    // happened when something did.
    it('still invites when the notification fails', async () => {
      notificationService.createNotification.mockRejectedValue(
        new Error('mail is down'),
      );

      await expect(
        service.invite(storyId, { userId: memberId }, ownerId),
      ).resolves.toBeDefined();
    });

    it('still invites when the notification fails with a non-Error', async () => {
      notificationService.createNotification.mockRejectedValue('mail is down');

      await expect(
        service.invite(storyId, { userId: memberId }, ownerId),
      ).resolves.toBeDefined();
    });
  });

  describe('answering an invitation', () => {
    beforeEach(() => {
      collaboratorRepository.findOne.mockResolvedValue(buildCollaborator());
    });

    it('accepts', async () => {
      const accepted = await service.accept(collaboratorId, memberId);

      expect(accepted.invitationStatus).toBe(
        CollaborationInvitationStatus.ACCEPTED,
      );
      expect(accepted.acceptedAt).toBeInstanceOf(Date);
    });

    it('declines', async () => {
      const declined = await service.decline(collaboratorId, memberId);

      expect(declined.invitationStatus).toBe(
        CollaborationInvitationStatus.DECLINED,
      );
    });

    // An owner accepting on somebody's behalf would defeat the whole point of
    // there being an invitation.
    it.each([
      ['accept', (id: string, user: string) => service.accept(id, user)],
      ['decline', (id: string, user: string) => service.decline(id, user)],
    ])('refuses to let anybody else %s it', async (_name, act) => {
      await expect(act(collaboratorId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it.each([
      CollaborationInvitationStatus.ACCEPTED,
      CollaborationInvitationStatus.DECLINED,
      CollaborationInvitationStatus.REVOKED,
    ])('refuses to answer an invitation already %s', async status => {
      collaboratorRepository.findOne.mockResolvedValue(
        buildCollaborator({ invitationStatus: status }),
      );

      await expect(service.accept(collaboratorId, memberId)).rejects.toThrow(
        /already been answered/,
      );
    });

    it('reports an invitation that does not exist', async () => {
      collaboratorRepository.findOne.mockResolvedValue(null);

      await expect(service.accept(collaboratorId, memberId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('changing what a collaborator may do', () => {
    beforeEach(() => {
      collaboratorRepository.findOne.mockResolvedValue(
        buildCollaborator({
          invitationStatus: CollaborationInvitationStatus.ACCEPTED,
        }),
      );
    });

    it('changes the capabilities', async () => {
      const updated = await service.updateCapabilities(
        collaboratorId,
        { canManageCharacters: true },
        ownerId,
      );

      expect(updated.canManageCharacters).toBe(true);
    });

    it('never grants publishing', async () => {
      const updated = await service.updateCapabilities(
        collaboratorId,
        { canPublish: true, canEditStory: true },
        ownerId,
      );

      expect(updated.canPublish).toBe(false);
      expect(updated.canEditStory).toBe(true);
    });

    it('needs permission to manage collaborators', async () => {
      await service.updateCapabilities(collaboratorId, {}, ownerId);

      expect(storyService.findEditableOrFail).toHaveBeenCalledWith(
        storyId,
        ownerId,
        StoryCapability.MANAGE_COLLABORATORS,
      );
    });

    it('refuses when the caller may not manage collaborators', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.updateCapabilities(collaboratorId, {}, strangerId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('revoking', () => {
    beforeEach(() => {
      collaboratorRepository.findOne.mockResolvedValue(
        buildCollaborator({
          invitationStatus: CollaborationInvitationStatus.ACCEPTED,
        }),
      );
    });

    it('revokes a collaboration', async () => {
      const revoked = await service.revoke(collaboratorId, ownerId);

      expect(revoked.invitationStatus).toBe(
        CollaborationInvitationStatus.REVOKED,
      );
      expect(revoked.revokedAt).toBeInstanceOf(Date);
    });

    // Somebody may always show themselves out, whatever they were granted.
    it('lets a collaborator step down without permission to manage anybody', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.revoke(collaboratorId, memberId),
      ).resolves.toBeDefined();
      expect(storyService.findEditableOrFail).not.toHaveBeenCalled();
    });

    it('refuses to let a stranger remove somebody', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(service.revoke(collaboratorId, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    // The row is kept so the Story's history still shows somebody worked on it.
    it('keeps the row rather than deleting it', async () => {
      await service.revoke(collaboratorId, ownerId);

      expect(collaboratorRepository.save).toHaveBeenCalled();
    });
  });

  describe('listing', () => {
    it('lists a Story’s collaborators to anybody with access', async () => {
      await service.findByStory(storyId, memberId);

      expect(storyService.findAccessibleOrFail).toHaveBeenCalledWith(
        storyId,
        memberId,
      );
      expect(collaboratorRepository.find).toHaveBeenCalledWith({
        where: { storyId },
        order: { invitedAt: 'ASC' },
      });
    });

    it('refuses to list a Story the caller has no access to', async () => {
      storyService.findAccessibleOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(service.findByStory(storyId, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lists the invitations waiting on somebody', async () => {
      await service.findPendingForUser(memberId);

      expect(collaboratorRepository.find).toHaveBeenCalledWith({
        where: {
          userId: memberId,
          invitationStatus: CollaborationInvitationStatus.INVITED,
        },
        order: { invitedAt: 'DESC' },
      });
    });
  });
});
