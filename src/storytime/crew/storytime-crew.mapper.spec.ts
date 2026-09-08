import { Test, TestingModule } from '@nestjs/testing';

import { CollaborationInvitationStatus } from '../enums/collaboration-invitation-status.enum';
import { CrewCreditScope } from '../enums/crew-credit-scope.enum';
import { StorytimeCrewCreditEntity } from './entities/storytime-crew-credit.entity';
import { StorytimeCrewRoleEntity } from './entities/storytime-crew-role.entity';
import { StorytimeStoryCollaboratorEntity } from './entities/storytime-story-collaborator.entity';
import { StorytimeCrewMapper } from './storytime-crew.mapper';

describe('StorytimeCrewMapper', () => {
  let mapper: StorytimeCrewMapper;

  const role = Object.assign(new StorytimeCrewRoleEntity(), {
    id: 'role-1',
    code: 'NARRATOR',
    name: 'Narrator',
    description: 'Narrated the Story.',
    displayOrder: 7000,
    isSystem: true,
  });

  /**
   * Builds a credit.
   *
   * @param overrides - Fields to change.
   * @returns The credit entity.
   */
  const buildCredit = (
    overrides: Partial<StorytimeCrewCreditEntity> = {},
  ): StorytimeCrewCreditEntity =>
    Object.assign(new StorytimeCrewCreditEntity(), {
      id: 'credit-1',
      storyId: 'story-1',
      chapterId: null,
      characterId: null,
      userId: 'user-1',
      roleId: 'role-1',
      creditLabel: null,
      notes: null,
      orderIndex: 1000,
      ...overrides,
    });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeCrewMapper],
    }).compile();

    mapper = module.get<StorytimeCrewMapper>(StorytimeCrewMapper);
  });

  it('is defined', () => {
    expect(mapper).toBeDefined();
  });

  describe('collaborations', () => {
    const collaborator = Object.assign(new StorytimeStoryCollaboratorEntity(), {
      id: 'collaborator-1',
      storyId: 'story-1',
      userId: 'user-1',
      collaborationRole: 'Co-writer',
      canEditStory: true,
      canManageChapters: true,
      canManageCharacters: false,
      canManageCrew: false,
      canManageCollaborators: false,
      canPublish: false,
      invitationStatus: CollaborationInvitationStatus.ACCEPTED,
      invitedByUserId: 'owner-1',
      invitedAt: new Date('2026-05-01T10:00:00.000Z'),
      acceptedAt: new Date('2026-05-02T10:00:00.000Z'),
      revokedAt: null,
    });

    it('maps what the team sees', () => {
      const dto = mapper.toCollaborator(collaborator);

      expect(dto.canEditStory).toBe(true);
      expect(dto.invitationStatus).toBe(CollaborationInvitationStatus.ACCEPTED);
      expect(dto.collaborationRole).toBe('Co-writer');
    });

    // It is always false and cannot be granted, so returning it would only
    // invite a client to build a control for something that does not exist.
    it('never returns canPublish', () => {
      const dto = mapper.toCollaborator(collaborator) as unknown as Record<
        string,
        unknown
      >;

      expect(dto).not.toHaveProperty('canPublish');
    });

    it('maps a list', () => {
      expect(mapper.toCollaboratorList([collaborator])).toHaveLength(1);
    });

    it('maps an empty list', () => {
      expect(mapper.toCollaboratorList([])).toEqual([]);
    });
  });

  describe('roles', () => {
    it('maps a role', () => {
      expect(mapper.toRole(role)).toEqual({
        id: 'role-1',
        code: 'NARRATOR',
        name: 'Narrator',
        description: 'Narrated the Story.',
        displayOrder: 7000,
      });
    });

    it('maps a list', () => {
      expect(mapper.toRoleList([role])).toHaveLength(1);
    });
  });

  describe('credits', () => {
    it('pairs each credit with its role', () => {
      const [dto] = mapper.toCreditList([buildCredit()], [role]);

      expect(dto.role?.name).toBe('Narrator');
      expect(dto.scope).toBe(CrewCreditScope.STORY);
    });

    // Deciding this in every client would eventually mean deciding it
    // differently in one of them.
    it('reads as the role name when no wording was given', () => {
      const [dto] = mapper.toCreditList([buildCredit()], [role]);

      expect(dto.displayLabel).toBe('Narrator');
    });

    it('reads as its own wording when one was given', () => {
      const [dto] = mapper.toCreditList(
        [buildCredit({ creditLabel: 'Additional dialogue' })],
        [role],
      );

      expect(dto.displayLabel).toBe('Additional dialogue');
    });

    // A role deleted out from under a credit should still leave something
    // readable rather than a blank line in the credits roll.
    it('falls back to a generic label when the role is missing', () => {
      const [dto] = mapper.toCreditList([buildCredit()], []);

      expect(dto.role).toBeNull();
      expect(dto.displayLabel).toBe('Contributor');
    });

    it('reports a Chapter credit as such', () => {
      const [dto] = mapper.toCreditList(
        [buildCredit({ chapterId: 'chapter-1' })],
        [role],
      );

      expect(dto.scope).toBe(CrewCreditScope.CHAPTER);
    });

    it('reports a Character credit as such', () => {
      const [dto] = mapper.toCreditList(
        [buildCredit({ characterId: 'character-1' })],
        [role],
      );

      expect(dto.scope).toBe(CrewCreditScope.CHARACTER);
    });

    it('maps an empty credits roll', () => {
      expect(mapper.toCreditList([], [])).toEqual([]);
    });
  });
});
