import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorytimeArcCollaboratorEntity } from '../arcs/entities/storytime-arc-collaborator.entity';
import { CollaborationInvitationStatus } from '../enums/collaboration-invitation-status.enum';
import { ArcCapability } from './storytime-arc-capability.enum';
import { StorytimeArcCollaboratorAccessService } from './storytime-arc-collaborator-access.service';

describe('StorytimeArcCollaboratorAccessService', () => {
  let service: StorytimeArcCollaboratorAccessService;
  let collaboratorRepository: { find: jest.Mock; findOne: jest.Mock };

  const arcId = 'arc-1';
  const userId = 'user-1';

  /**
   * Builds an accepted collaboration granting the given capabilities.
   *
   * @param overrides - Capabilities and status to change.
   * @returns The collaboration entity.
   */
  const buildCollaborator = (
    overrides: Partial<StorytimeArcCollaboratorEntity> = {},
  ): StorytimeArcCollaboratorEntity =>
    Object.assign(new StorytimeArcCollaboratorEntity(), {
      id: 'collaborator-1',
      arcId,
      userId,
      canEditArc: false,
      canManageStories: false,
      canManageCollaborators: false,
      canPublish: false,
      invitationStatus: CollaborationInvitationStatus.ACCEPTED,
      ...overrides,
    });

  beforeEach(async () => {
    collaboratorRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeArcCollaboratorAccessService,
        {
          provide: getRepositoryToken(StorytimeArcCollaboratorEntity),
          useValue: collaboratorRepository,
        },
      ],
    }).compile();

    service = module.get<StorytimeArcCollaboratorAccessService>(
      StorytimeArcCollaboratorAccessService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  // Only an accepted invitation grants anything, exactly as for Stories.
  it('grants nothing to somebody with no collaboration', async () => {
    await expect(
      service.hasCapability(arcId, userId, ArcCapability.EDIT_ARC),
    ).resolves.toBe(false);
  });

  it('asks only for accepted collaborations', async () => {
    await service.hasCapability(arcId, userId, ArcCapability.MANAGE_STORIES);

    expect(collaboratorRepository.findOne).toHaveBeenCalledWith({
      where: {
        arcId,
        userId,
        invitationStatus: CollaborationInvitationStatus.ACCEPTED,
      },
    });
  });

  it.each([
    [ArcCapability.EDIT_ARC, 'canEditArc'],
    [ArcCapability.MANAGE_STORIES, 'canManageStories'],
    [ArcCapability.MANAGE_COLLABORATORS, 'canManageCollaborators'],
  ])('grants %s when its own column is set', async (capability, column) => {
    collaboratorRepository.findOne.mockResolvedValue(
      buildCollaborator({ [column]: true }),
    );

    await expect(
      service.hasCapability(arcId, userId, capability),
    ).resolves.toBe(true);
  });

  // Somebody brought in to chase up Story owners has not been handed the Arc.
  it.each([ArcCapability.EDIT_ARC, ArcCapability.MANAGE_COLLABORATORS])(
    'refuses %s to a Stories-only collaborator',
    async capability => {
      collaboratorRepository.findOne.mockResolvedValue(
        buildCollaborator({ canManageStories: true }),
      );

      await expect(
        service.hasCapability(arcId, userId, capability),
      ).resolves.toBe(false);
    },
  );

  it('refuses everything to a collaboration granting nothing', async () => {
    collaboratorRepository.findOne.mockResolvedValue(buildCollaborator());

    const results = await Promise.all(
      Object.values(ArcCapability).map(capability =>
        service.hasCapability(arcId, userId, capability),
      ),
    );

    expect(results).toEqual(results.map(() => false));
  });

  describe('finding collaborations', () => {
    it('finds an accepted collaboration', async () => {
      collaboratorRepository.findOne.mockResolvedValue(buildCollaborator());

      await expect(service.findAccepted(arcId, userId)).resolves.toBeDefined();
    });

    it('reports nothing when there is none', async () => {
      await expect(service.findAccepted(arcId, userId)).resolves.toBeNull();
    });

    it('lists the Arcs somebody has accepted', async () => {
      await service.findAcceptedForUser(userId);

      expect(collaboratorRepository.find).toHaveBeenCalledWith({
        where: {
          userId,
          invitationStatus: CollaborationInvitationStatus.ACCEPTED,
        },
      });
    });
  });
});
