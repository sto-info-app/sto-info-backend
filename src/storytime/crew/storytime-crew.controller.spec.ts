import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { CollaborationInvitationStatus } from '../enums/collaboration-invitation-status.enum';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeCrewCreditEntity } from './entities/storytime-crew-credit.entity';
import { StorytimeCrewRoleEntity } from './entities/storytime-crew-role.entity';
import { StorytimeStoryCollaboratorEntity } from './entities/storytime-story-collaborator.entity';
import { StorytimeCollaboratorService } from './storytime-collaborator.service';
import { StorytimeCrewCreditService } from './storytime-crew-credit.service';
import { StorytimeCrewController } from './storytime-crew.controller';
import { StorytimeCrewMapper } from './storytime-crew.mapper';

describe('StorytimeCrewController', () => {
  let controller: StorytimeCrewController;
  let collaboratorService: {
    findByStory: jest.Mock;
    findPendingForUser: jest.Mock;
    invite: jest.Mock;
    updateCapabilities: jest.Mock;
    accept: jest.Mock;
    decline: jest.Mock;
    revoke: jest.Mock;
  };
  let creditService: {
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    findRolesByIds: jest.Mock;
  };
  let featureService: { assertFlagEnabled: jest.Mock };

  const userId = 'user-1';
  const storyId = 'story-1';
  const collaboratorId = 'collaborator-1';
  const creditId = 'credit-1';
  const roleId = 'role-1';

  const collaborator = Object.assign(new StorytimeStoryCollaboratorEntity(), {
    id: collaboratorId,
    storyId,
    userId: 'member-1',
    collaborationRole: null,
    canEditStory: false,
    canManageChapters: true,
    canManageCharacters: false,
    canManageCrew: false,
    canManageCollaborators: false,
    invitationStatus: CollaborationInvitationStatus.INVITED,
    invitedByUserId: userId,
    invitedAt: new Date(),
    acceptedAt: null,
  });

  const credit = Object.assign(new StorytimeCrewCreditEntity(), {
    id: creditId,
    storyId,
    chapterId: null,
    characterId: null,
    userId: 'member-1',
    roleId,
    creditLabel: null,
    notes: null,
    orderIndex: 1000,
  });

  const role = Object.assign(new StorytimeCrewRoleEntity(), {
    id: roleId,
    code: 'NARRATOR',
    name: 'Narrator',
    description: null,
    displayOrder: 7000,
  });

  beforeEach(async () => {
    collaboratorService = {
      findByStory: jest.fn().mockResolvedValue([collaborator]),
      findPendingForUser: jest.fn().mockResolvedValue([collaborator]),
      invite: jest.fn().mockResolvedValue(collaborator),
      updateCapabilities: jest.fn().mockResolvedValue(collaborator),
      accept: jest.fn().mockResolvedValue(collaborator),
      decline: jest.fn().mockResolvedValue(collaborator),
      revoke: jest.fn().mockResolvedValue(collaborator),
    };
    creditService = {
      create: jest.fn().mockResolvedValue(credit),
      update: jest.fn().mockResolvedValue(credit),
      remove: jest.fn().mockResolvedValue(undefined),
      findRolesByIds: jest.fn().mockResolvedValue([role]),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeCrewController],
      providers: [
        {
          provide: StorytimeCollaboratorService,
          useValue: collaboratorService,
        },
        { provide: StorytimeCrewCreditService, useValue: creditService },
        StorytimeCrewMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
        { provide: AccessControlService, useValue: { can: jest.fn() } },
      ],
    }).compile();

    controller = module.get<StorytimeCrewController>(StorytimeCrewController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists a Story’s collaborators', async () => {
    const result = await controller.findCollaborators(storyId, userId);

    expect(result).toHaveLength(1);
    expect(collaboratorService.findByStory).toHaveBeenCalledWith(
      storyId,
      userId,
    );
  });

  it('lists the caller’s own invitations', async () => {
    await controller.findMyInvitations(userId);

    expect(collaboratorService.findPendingForUser).toHaveBeenCalledWith(userId);
  });

  it('invites somebody', async () => {
    await controller.invite(storyId, { userId: 'member-1' }, userId);

    expect(collaboratorService.invite).toHaveBeenCalledWith(
      storyId,
      { userId: 'member-1' },
      userId,
    );
  });

  it('changes what a collaborator may do', async () => {
    await controller.updateCollaborator(
      collaboratorId,
      { canManageCrew: true },
      userId,
    );

    expect(collaboratorService.updateCapabilities).toHaveBeenCalledWith(
      collaboratorId,
      { canManageCrew: true },
      userId,
    );
  });

  it.each([
    ['accept', 'accept'],
    ['decline', 'decline'],
    ['revoke', 'revoke'],
  ])('%ss a collaboration', async (_name, method) => {
    const act =
      controller[method as 'accept' | 'decline' | 'revoke'].bind(controller);

    await act(collaboratorId, userId);

    expect(
      collaboratorService[method as 'accept' | 'decline' | 'revoke'],
    ).toHaveBeenCalledWith(collaboratorId, userId);
  });

  describe('credits', () => {
    it('adds a credit and returns it with its role', async () => {
      const result = await controller.createCredit(
        storyId,
        { userId: 'member-1', roleId },
        userId,
      );

      expect(result.displayLabel).toBe('Narrator');
      expect(creditService.create).toHaveBeenCalled();
    });

    it('rewords a credit', async () => {
      const result = await controller.updateCredit(
        creditId,
        { creditLabel: 'Additional dialogue' },
        userId,
      );

      expect(result.id).toBe(creditId);
      expect(creditService.update).toHaveBeenCalledWith(
        creditId,
        { creditLabel: 'Additional dialogue' },
        userId,
      );
    });

    it('removes a credit', async () => {
      await controller.removeCredit(creditId, userId);

      expect(creditService.remove).toHaveBeenCalledWith(creditId, userId);
    });
  });

  // Collaboration and credits are part of creating, so they go away with the
  // rest of it rather than carrying on behind a switched-off feature.
  describe('when creation is switched off', () => {
    beforeEach(() => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new ForbiddenException(),
      );
    });

    it.each([
      [
        'findCollaborators',
        () => controller.findCollaborators(storyId, userId),
      ],
      ['findMyInvitations', () => controller.findMyInvitations(userId)],
      ['invite', () => controller.invite(storyId, { userId: 'm' }, userId)],
      [
        'updateCollaborator',
        () => controller.updateCollaborator(collaboratorId, {}, userId),
      ],
      ['accept', () => controller.accept(collaboratorId, userId)],
      ['decline', () => controller.decline(collaboratorId, userId)],
      ['revoke', () => controller.revoke(collaboratorId, userId)],
      [
        'createCredit',
        () => controller.createCredit(storyId, { userId: 'm', roleId }, userId),
      ],
      ['updateCredit', () => controller.updateCredit(creditId, {}, userId)],
      ['removeCredit', () => controller.removeCredit(creditId, userId)],
    ])('refuses %s', async (_name, act) => {
      await expect(act()).rejects.toThrow(ForbiddenException);
      expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
        STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
      );
    });
  });
});
