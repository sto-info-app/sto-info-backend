import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationService } from '../../notification/notification.service';
import { ArcCapability } from '../collaboration/storytime-arc-capability.enum';
import { CollaborationInvitationStatus } from '../enums/collaboration-invitation-status.enum';
import { StorytimeArcCollaboratorEntity } from './entities/storytime-arc-collaborator.entity';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';
import { StorytimeArcCollaboratorService } from './storytime-arc-collaborator.service';
import { StorytimeArcService } from './storytime-arc.service';

describe('StorytimeArcCollaboratorService', () => {
  let service: StorytimeArcCollaboratorService;
  let collaboratorRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let arcService: {
    findEditableOrFail: jest.Mock;
    findAccessibleOrFail: jest.Mock;
  };
  let notificationService: { createNotification: jest.Mock };

  const curatorId = 'curator-1';
  const memberId = 'member-1';
  const strangerId = 'stranger-1';
  const arcId = 'arc-1';
  const collaboratorId = 'collaborator-1';

  /**
   * Builds a collaboration.
   *
   * @param overrides - Fields to change.
   * @returns The collaboration entity.
   */
  const buildCollaborator = (
    overrides: Partial<StorytimeArcCollaboratorEntity> = {},
  ): StorytimeArcCollaboratorEntity =>
    Object.assign(new StorytimeArcCollaboratorEntity(), {
      id: collaboratorId,
      arcId,
      userId: memberId,
      canEditArc: false,
      canManageStories: false,
      canManageCollaborators: false,
      canPublish: false,
      invitationStatus: CollaborationInvitationStatus.INVITED,
      invitedByUserId: curatorId,
      invitedAt: new Date(),
      acceptedAt: null,
      revokedAt: null,
      ...overrides,
    });

  beforeEach(async () => {
    collaboratorRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(() => new StorytimeArcCollaboratorEntity()),
      save: jest.fn(input => Promise.resolve(input)),
    };
    arcService = {
      findEditableOrFail: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeArcEntity(), {
          id: arcId,
          ownerUserId: curatorId,
          title: 'The Long War',
        }),
      ),
      findAccessibleOrFail: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeArcEntity(), {
          id: arcId,
          ownerUserId: curatorId,
        }),
      ),
    };
    notificationService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeArcCollaboratorService,
        {
          provide: getRepositoryToken(StorytimeArcCollaboratorEntity),
          useValue: collaboratorRepository,
        },
        { provide: StorytimeArcService, useValue: arcService },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get<StorytimeArcCollaboratorService>(
      StorytimeArcCollaboratorService,
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
        arcId,
        { userId: memberId, canManageStories: true },
        curatorId,
      );

      expect(invited.userId).toBe(memberId);
      expect(invited.canManageStories).toBe(true);
    });

    // Access is something a person accepts, never something a curator assigns.
    it('grants nothing until it is accepted', async () => {
      const invited = await service.invite(
        arcId,
        { userId: memberId, canEditArc: true },
        curatorId,
      );

      expect(invited.invitationStatus).toBe(
        CollaborationInvitationStatus.INVITED,
      );
      expect(invited.acceptedAt).toBeNull();
    });

    it('needs permission to manage collaborators', async () => {
      await service.invite(arcId, { userId: memberId }, curatorId);

      expect(arcService.findEditableOrFail).toHaveBeenCalledWith(
        arcId,
        curatorId,
        ArcCapability.MANAGE_COLLABORATORS,
      );
    });

    // Publishing is not delegable, whatever the request says.
    it('never grants publishing', async () => {
      const invited = await service.invite(
        arcId,
        { userId: memberId, canPublish: true },
        curatorId,
      );

      expect(invited.canPublish).toBe(false);
    });

    it('grants nothing by default', async () => {
      const invited = await service.invite(
        arcId,
        { userId: memberId },
        curatorId,
      );

      expect(invited.canEditArc).toBe(false);
      expect(invited.canManageStories).toBe(false);
      expect(invited.canManageCollaborators).toBe(false);
    });

    it('refuses to invite the curator', async () => {
      await expect(
        service.invite(arcId, { userId: curatorId }, curatorId),
      ).rejects.toThrow(/already able to do everything/);
    });

    it.each([
      CollaborationInvitationStatus.INVITED,
      CollaborationInvitationStatus.ACCEPTED,
    ])('refuses somebody already %s', async status => {
      collaboratorRepository.findOne.mockResolvedValue(
        buildCollaborator({ invitationStatus: status }),
      );

      await expect(
        service.invite(arcId, { userId: memberId }, curatorId),
      ).rejects.toThrow(/already been invited/);
    });

    it.each([
      CollaborationInvitationStatus.DECLINED,
      CollaborationInvitationStatus.REVOKED,
    ])('re-invites somebody who previously %s', async status => {
      collaboratorRepository.findOne.mockResolvedValue(
        buildCollaborator({ invitationStatus: status, revokedAt: new Date() }),
      );

      const invited = await service.invite(
        arcId,
        { userId: memberId },
        curatorId,
      );

      expect(invited.invitationStatus).toBe(
        CollaborationInvitationStatus.INVITED,
      );
      expect(invited.revokedAt).toBeNull();
      expect(collaboratorRepository.create).not.toHaveBeenCalled();
    });

    it('tells the invited member', async () => {
      await service.invite(arcId, { userId: memberId }, curatorId);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: memberId,
          body: expect.stringContaining('The Long War'),
        }),
      );
    });

    it.each([
      ['an Error', new Error('mail is down')],
      ['a non-Error', 'mail is down'],
    ])(
      'still invites when the notification fails with %s',
      async (_name, failure) => {
        notificationService.createNotification.mockRejectedValue(failure);

        await expect(
          service.invite(arcId, { userId: memberId }, curatorId),
        ).resolves.toBeDefined();
      },
    );
  });

  describe('answering', () => {
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

    // A curator accepting on somebody's behalf would defeat the point.
    it.each([
      ['accept', (id: string, user: string) => service.accept(id, user)],
      ['decline', (id: string, user: string) => service.decline(id, user)],
    ])('refuses to let anybody else %s it', async (_name, act) => {
      await expect(act(collaboratorId, curatorId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses to answer an invitation already answered', async () => {
      collaboratorRepository.findOne.mockResolvedValue(
        buildCollaborator({
          invitationStatus: CollaborationInvitationStatus.ACCEPTED,
        }),
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
        { canManageStories: true },
        curatorId,
      );

      expect(updated.canManageStories).toBe(true);
    });

    it('never grants publishing', async () => {
      const updated = await service.updateCapabilities(
        collaboratorId,
        { canPublish: true, canEditArc: true },
        curatorId,
      );

      expect(updated.canPublish).toBe(false);
      expect(updated.canEditArc).toBe(true);
    });

    // Moving a collaboration to a different member would silently transfer
    // whatever the first person had accepted.
    it('never moves a collaboration to somebody else', async () => {
      const updated = await service.updateCapabilities(
        collaboratorId,
        { userId: strangerId },
        curatorId,
      );

      expect(updated.userId).toBe(memberId);
    });

    it('refuses when the caller may not manage collaborators', async () => {
      arcService.findEditableOrFail.mockRejectedValue(new ForbiddenException());

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
      const revoked = await service.revoke(collaboratorId, curatorId);

      expect(revoked.invitationStatus).toBe(
        CollaborationInvitationStatus.REVOKED,
      );
      expect(revoked.revokedAt).toBeInstanceOf(Date);
    });

    // Somebody may always show themselves out.
    it('lets a collaborator step down without permission to manage anybody', async () => {
      arcService.findEditableOrFail.mockRejectedValue(new ForbiddenException());

      await expect(
        service.revoke(collaboratorId, memberId),
      ).resolves.toBeDefined();
      expect(arcService.findEditableOrFail).not.toHaveBeenCalled();
    });

    it('refuses to let a stranger remove somebody', async () => {
      arcService.findEditableOrFail.mockRejectedValue(new ForbiddenException());

      await expect(service.revoke(collaboratorId, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('listing', () => {
    it('lists an Arc’s collaborators to anybody with access', async () => {
      await service.findByArc(arcId, memberId);

      expect(arcService.findAccessibleOrFail).toHaveBeenCalledWith(
        arcId,
        memberId,
      );
    });

    it('refuses to list an Arc the caller has no access to', async () => {
      arcService.findAccessibleOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(service.findByArc(arcId, strangerId)).rejects.toThrow(
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
