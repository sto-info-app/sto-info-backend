import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { EntityManager } from 'typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { CharacterFleetMembershipService } from '../../services/character-fleet-membership.service';
import { CurrentRecruitment } from './recruitment-settings.service';

/**
 * Who may come into a Fleet, and with which Character (FC-021).
 *
 * The checks the three ways in share. The Character must be the person's
 * own — the story's second criterion — and play on the Fleet's platform.
 * The Fleet's requirements apply to joining and applying, and not to an
 * invitation, whose invitee an officer chose (Steve's decision of 26
 * September 2026).
 */
@Injectable()
export class RecruitmentEligibilityService {
  /**
   * Creates an instance of RecruitmentEligibilityService.
   *
   * @param _characterMemberships - Proves a Character is somebody's own.
   * @param _audience - Says whether somebody may see a Fleet.
   */
  constructor(
    private readonly _characterMemberships: CharacterFleetMembershipService,
    private readonly _audience: FleetAudienceService,
  ) {}

  /**
   * Reads a Fleet that is taking members, with its Community and platform.
   *
   * @param manager - The transaction to read in.
   * @param communityId - The Community the route named.
   * @param fleetId - The Fleet.
   * @returns The Fleet.
   * @throws NotFoundException when there is no such Fleet in that Community.
   * @throws ConflictException when the Fleet or its Community is not active.
   */
  async loadFleet(
    manager: EntityManager,
    communityId: string,
    fleetId: string,
  ): Promise<StoFleetEntity> {
    const fleet = await manager.findOne(StoFleetEntity, {
      where: { id: fleetId, communityId },
      relations: { community: true, platform: true },
    });

    if (fleet === null) {
      throw new NotFoundException('Not found');
    }

    if (
      fleet.status !== FleetScopeStatus.ACTIVE ||
      fleet.community?.status !== FleetScopeStatus.ACTIVE
    ) {
      throw new ConflictException('This Fleet is not taking new members.');
    }

    return fleet;
  }

  /**
   * Refuses somebody who may not see the Fleet, as though it did not exist.
   *
   * @param fleet - The Fleet.
   * @param userId - Who is asking.
   * @throws NotFoundException when they may not see it.
   */
  async assertVisible(fleet: StoFleetEntity, userId: string): Promise<void> {
    const visible = await this._audience.canViewScope(
      { kind: FleetScopeKind.FLEET, id: fleet.id },
      userId,
    );

    if (!visible) {
      throw new NotFoundException('Not found');
    }
  }

  /**
   * Refuses the Community's Owner, who has the Fleet's access already.
   *
   * @param fleet - The Fleet, with its Community.
   * @param userId - Who is asking.
   * @throws ConflictException when they own the Community.
   */
  assertNotOwner(fleet: StoFleetEntity, userId: string): void {
    if (fleet.community?.ownerUserId === userId) {
      throw new ConflictException(
        'You own this Fleet’s Community, so you have its access already.',
      );
    }
  }

  /**
   * Reads a Character somebody may come into the Fleet with.
   *
   * @param manager - The transaction to read in.
   * @param fleet - The Fleet.
   * @param characterId - The Character.
   * @param userId - Who must own it.
   * @param requirements - The Fleet's requirements, or null for an
   *   invitation, which bypasses them.
   * @returns The Character, locked.
   * @throws NotFoundException when there is no such Character.
   * @throws ForbiddenException when it is not theirs.
   * @throws BadRequestException when it is on another platform or falls
   *   short of a requirement.
   */
  async requireCharacter(
    manager: EntityManager,
    fleet: StoFleetEntity,
    characterId: string,
    userId: string,
    requirements: CurrentRecruitment | null,
  ): Promise<CharacterEntity> {
    const character = await this._characterMemberships.requireOwnedCharacter(
      manager,
      characterId,
      userId,
      { lock: true },
    );
    const account = await manager.findOne(AccountEntity, {
      where: { id: character.accountId },
    });

    if (account?.platformId !== fleet.platformId) {
      throw new BadRequestException(
        'That Character plays on a different platform from this Fleet.',
      );
    }

    if (requirements === null) {
      return character;
    }

    const minimum = requirements.minimumLevel;

    if (minimum !== null && (character.level ?? 0) < minimum) {
      throw new BadRequestException(
        `This Fleet asks for Characters of level ${minimum} or higher.` +
          (character.level === null
            ? ' Record your Character’s level on its page first.'
            : ''),
      );
    }

    if (
      requirements.factionIds.length > 0 &&
      !requirements.factionIds.includes(character.factionId)
    ) {
      throw new BadRequestException(
        'This Fleet does not take Characters of that faction.',
      );
    }

    return character;
  }
}
