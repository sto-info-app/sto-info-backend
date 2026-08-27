import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorytimeStoryCollaboratorEntity } from '../crew/entities/storytime-story-collaborator.entity';
import { CollaborationInvitationStatus } from '../enums/collaboration-invitation-status.enum';
import { StorytimeCollaboratorAccessService } from './storytime-collaborator-access.service';
import { StoryCapability } from './storytime-story-capability.enum';

describe('StorytimeCollaboratorAccessService', () => {
  let service: StorytimeCollaboratorAccessService;
  let collaboratorRepository: { find: jest.Mock; findOne: jest.Mock };

  const storyId = 'story-1';
  const userId = 'user-1';

  /**
   * Builds an accepted collaboration granting the given capabilities.
   *
   * @param overrides - Capabilities and status to change.
   * @returns The collaboration entity.
   */
  const buildCollaborator = (
    overrides: Partial<StorytimeStoryCollaboratorEntity> = {},
  ): StorytimeStoryCollaboratorEntity =>
    Object.assign(new StorytimeStoryCollaboratorEntity(), {
      id: 'collaborator-1',
      storyId,
      userId,
      canEditStory: false,
      canManageChapters: false,
      canManageCharacters: false,
      canManageCrew: false,
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
        StorytimeCollaboratorAccessService,
        {
          provide: getRepositoryToken(StorytimeStoryCollaboratorEntity),
          useValue: collaboratorRepository,
        },
      ],
    }).compile();

    service = module.get<StorytimeCollaboratorAccessService>(
      StorytimeCollaboratorAccessService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  // Only an accepted invitation grants anything. This is the whole reason the
  // table exists rather than a list of names.
  describe('only an accepted collaboration counts', () => {
    it('grants nothing to somebody with no collaboration at all', async () => {
      await expect(
        service.hasCapability(storyId, userId, StoryCapability.EDIT_STORY),
      ).resolves.toBe(false);
    });

    it('asks only for accepted collaborations', async () => {
      await service.hasCapability(
        storyId,
        userId,
        StoryCapability.MANAGE_CHAPTERS,
      );

      expect(collaboratorRepository.findOne).toHaveBeenCalledWith({
        where: {
          storyId,
          userId,
          invitationStatus: CollaborationInvitationStatus.ACCEPTED,
        },
      });
    });
  });

  describe('each capability comes from its own grant', () => {
    it.each([
      [StoryCapability.EDIT_STORY, 'canEditStory'],
      [StoryCapability.MANAGE_CHAPTERS, 'canManageChapters'],
      [StoryCapability.MANAGE_CHARACTERS, 'canManageCharacters'],
      [StoryCapability.MANAGE_CREW, 'canManageCrew'],
      [StoryCapability.MANAGE_COLLABORATORS, 'canManageCollaborators'],
    ])('grants %s when its own column is set', async (capability, column) => {
      collaboratorRepository.findOne.mockResolvedValue(
        buildCollaborator({ [column]: true }),
      );

      await expect(
        service.hasCapability(storyId, userId, capability),
      ).resolves.toBe(true);
    });

    // A collaborator invited to write Chapters has not been handed the cast,
    // the credits, or the ability to invite anybody else.
    it.each([
      StoryCapability.EDIT_STORY,
      StoryCapability.MANAGE_CHARACTERS,
      StoryCapability.MANAGE_CREW,
      StoryCapability.MANAGE_COLLABORATORS,
    ])('refuses %s to a Chapter-only collaborator', async capability => {
      collaboratorRepository.findOne.mockResolvedValue(
        buildCollaborator({ canManageChapters: true }),
      );

      await expect(
        service.hasCapability(storyId, userId, capability),
      ).resolves.toBe(false);
    });

    it('refuses everything to a collaboration granting nothing', async () => {
      collaboratorRepository.findOne.mockResolvedValue(buildCollaborator());

      const results = await Promise.all(
        Object.values(StoryCapability).map(capability =>
          service.hasCapability(storyId, userId, capability),
        ),
      );

      expect(results).toEqual(results.map(() => false));
    });
  });

  describe('finding collaborations', () => {
    it('finds an accepted collaboration', async () => {
      collaboratorRepository.findOne.mockResolvedValue(buildCollaborator());

      await expect(
        service.findAccepted(storyId, userId),
      ).resolves.toBeDefined();
    });

    it('reports nothing when there is no accepted collaboration', async () => {
      await expect(service.findAccepted(storyId, userId)).resolves.toBeNull();
    });

    it('lists the Stories somebody has accepted', async () => {
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
