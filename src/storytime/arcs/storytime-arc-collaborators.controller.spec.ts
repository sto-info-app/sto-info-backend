import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { CollaborationInvitationStatus } from '../enums/collaboration-invitation-status.enum';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeArcCollaboratorEntity } from './entities/storytime-arc-collaborator.entity';
import { StorytimeArcCollaboratorService } from './storytime-arc-collaborator.service';
import { StorytimeArcCollaboratorsController } from './storytime-arc-collaborators.controller';
import { StorytimeArcMapper } from './storytime-arc.mapper';

describe('StorytimeArcCollaboratorsController', () => {
  let controller: StorytimeArcCollaboratorsController;
  let collaboratorService: {
    findByArc: jest.Mock;
    findPendingForUser: jest.Mock;
    invite: jest.Mock;
    updateCapabilities: jest.Mock;
    accept: jest.Mock;
    decline: jest.Mock;
    revoke: jest.Mock;
  };
  let featureService: { assertFlagEnabled: jest.Mock };

  const userId = 'user-1';
  const arcId = 'arc-1';
  const collaboratorId = 'collaborator-1';

  const collaborator = Object.assign(new StorytimeArcCollaboratorEntity(), {
    id: collaboratorId,
    arcId,
    userId: 'member-1',
    collaborationRole: null,
    canEditArc: false,
    canManageStories: true,
    canManageCollaborators: false,
    invitationStatus: CollaborationInvitationStatus.INVITED,
    invitedByUserId: userId,
    invitedAt: new Date(),
    acceptedAt: null,
  });

  beforeEach(async () => {
    collaboratorService = {
      findByArc: jest.fn().mockResolvedValue([collaborator]),
      findPendingForUser: jest.fn().mockResolvedValue([collaborator]),
      invite: jest.fn().mockResolvedValue(collaborator),
      updateCapabilities: jest.fn().mockResolvedValue(collaborator),
      accept: jest.fn().mockResolvedValue(collaborator),
      decline: jest.fn().mockResolvedValue(collaborator),
      revoke: jest.fn().mockResolvedValue(collaborator),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeArcCollaboratorsController],
      providers: [
        {
          provide: StorytimeArcCollaboratorService,
          useValue: collaboratorService,
        },
        StorytimeArcMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<StorytimeArcCollaboratorsController>(
      StorytimeArcCollaboratorsController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists an Arc’s collaborators', async () => {
    const result = await controller.findByArc(arcId, userId);

    expect(result).toHaveLength(1);
    expect(collaboratorService.findByArc).toHaveBeenCalledWith(arcId, userId);
  });

  it('lists the caller’s own invitations', async () => {
    await controller.findMyInvitations(userId);

    expect(collaboratorService.findPendingForUser).toHaveBeenCalledWith(userId);
  });

  it('invites somebody', async () => {
    await controller.invite(arcId, { userId: 'member-1' }, userId);

    expect(collaboratorService.invite).toHaveBeenCalledWith(
      arcId,
      { userId: 'member-1' },
      userId,
    );
  });

  it('changes what a collaborator may do', async () => {
    await controller.update(collaboratorId, { canEditArc: true }, userId);

    expect(collaboratorService.updateCapabilities).toHaveBeenCalledWith(
      collaboratorId,
      { canEditArc: true },
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

  // It is always false and cannot be granted, so returning it would only
  // invite a client to build a control for something that does not exist.
  it('never returns canPublish', async () => {
    const [result] = await controller.findByArc(arcId, userId);

    expect(result as unknown as Record<string, unknown>).not.toHaveProperty(
      'canPublish',
    );
  });

  describe('when creation is switched off', () => {
    beforeEach(() => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new ForbiddenException(),
      );
    });

    it.each([
      ['findByArc', () => controller.findByArc(arcId, userId)],
      ['findMyInvitations', () => controller.findMyInvitations(userId)],
      ['invite', () => controller.invite(arcId, { userId: 'm' }, userId)],
      ['update', () => controller.update(collaboratorId, {}, userId)],
      ['accept', () => controller.accept(collaboratorId, userId)],
      ['decline', () => controller.decline(collaboratorId, userId)],
      ['revoke', () => controller.revoke(collaboratorId, userId)],
    ])('refuses %s', async (_name, act) => {
      await expect(act()).rejects.toThrow(ForbiddenException);
      expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
        STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
      );
    });
  });
});
