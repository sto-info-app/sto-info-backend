import { Injectable } from '@nestjs/common';

import { CollaboratorDto } from './dto/collaborator.dto';
import { CrewCreditDto, CrewRoleDto } from './dto/crew-credit.dto';
import { StorytimeCrewCreditEntity } from './entities/storytime-crew-credit.entity';
import { StorytimeCrewRoleEntity } from './entities/storytime-crew-role.entity';
import { StorytimeStoryCollaboratorEntity } from './entities/storytime-story-collaborator.entity';

/**
 * Turns collaborations and credits into the shapes the API returns.
 */
@Injectable()
export class StorytimeCrewMapper {
  /**
   * Maps a collaboration.
   *
   * `canPublish` never crosses the boundary. It is always false and cannot be
   * granted, so returning it would only invite a client to build a control for
   * something that does not exist.
   *
   * @param collaborator - The collaboration entity.
   * @returns The collaboration as the team sees it.
   */
  toCollaborator(
    collaborator: StorytimeStoryCollaboratorEntity,
  ): CollaboratorDto {
    return {
      id: collaborator.id,
      storyId: collaborator.storyId,
      userId: collaborator.userId,
      collaborationRole: collaborator.collaborationRole,
      canEditStory: collaborator.canEditStory,
      canManageChapters: collaborator.canManageChapters,
      canManageCharacters: collaborator.canManageCharacters,
      canManageCrew: collaborator.canManageCrew,
      canManageCollaborators: collaborator.canManageCollaborators,
      invitationStatus: collaborator.invitationStatus,
      invitedByUserId: collaborator.invitedByUserId,
      invitedAt: collaborator.invitedAt,
      acceptedAt: collaborator.acceptedAt,
    };
  }

  /**
   * Maps several collaborations.
   *
   * @param collaborators - The collaboration entities.
   * @returns The collaborations.
   */
  toCollaboratorList(
    collaborators: StorytimeStoryCollaboratorEntity[],
  ): CollaboratorDto[] {
    return collaborators.map(collaborator => this.toCollaborator(collaborator));
  }

  /**
   * Maps a Crew role.
   *
   * @param role - The role entity.
   * @returns The role.
   */
  toRole(role: StorytimeCrewRoleEntity): CrewRoleDto {
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      displayOrder: role.displayOrder,
    };
  }

  /**
   * Maps several Crew roles.
   *
   * @param roles - The role entities.
   * @returns The roles.
   */
  toRoleList(roles: StorytimeCrewRoleEntity[]): CrewRoleDto[] {
    return roles.map(role => this.toRole(role));
  }

  /**
   * Maps credits, pairing each with the role it names.
   *
   * The label is resolved here rather than in every client: a credit reads as
   * its own wording when one was given and as the role name otherwise, and
   * deciding that twice would eventually mean deciding it differently.
   *
   * @param credits - The credit entities.
   * @param roles - The roles they name.
   * @returns The credits as a credits roll.
   */
  toCreditList(
    credits: StorytimeCrewCreditEntity[],
    roles: StorytimeCrewRoleEntity[],
  ): CrewCreditDto[] {
    const byId = new Map(roles.map(role => [role.id, role]));

    return credits.map(credit => {
      const role = byId.get(credit.roleId) ?? null;

      return {
        id: credit.id,
        storyId: credit.storyId,
        chapterId: credit.chapterId,
        characterId: credit.characterId,
        userId: credit.userId,
        scope: credit.scope,
        role: role ? this.toRole(role) : null,
        displayLabel: credit.creditLabel ?? role?.name ?? 'Contributor',
        notes: credit.notes,
        orderIndex: credit.orderIndex,
      };
    });
  }
}
