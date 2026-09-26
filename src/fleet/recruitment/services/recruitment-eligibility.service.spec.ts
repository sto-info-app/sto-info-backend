import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { EntityManager } from 'typeorm';

import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetRecruitmentState } from '../../enums/fleet-recruitment-state.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { CharacterFleetMembershipService } from '../../services/character-fleet-membership.service';
import { RecruitmentEligibilityService } from './recruitment-eligibility.service';
import { CurrentRecruitment } from './recruitment-settings.service';

const FLEET = {
  id: 'fleet-1',
  communityId: 'community-1',
  platformId: 'windows',
  status: FleetScopeStatus.ACTIVE,
  community: { ownerUserId: 'owner-1', status: FleetScopeStatus.ACTIVE },
} as StoFleetEntity;

const FEDERATION = 'faction-federation';

/**
 * Builds the Fleet's requirements.
 *
 * @param changes - Fields to override.
 * @returns The requirements.
 */
function requirements(
  changes: Partial<CurrentRecruitment> = {},
): CurrentRecruitment {
  return {
    settings: null,
    version: 1,
    recruitmentState: FleetRecruitmentState.APPLICATION,
    requirementsText: null,
    minimumLevel: null,
    factionIds: [],
    questions: [],
    ...changes,
  };
}

describe('RecruitmentEligibilityService', () => {
  let character: Partial<CharacterEntity>;
  let account: { platformId: string } | null;
  let fleet: StoFleetEntity | null;
  let visible: boolean;
  let requireOwnedCharacter: jest.Mock;
  let manager: { findOne: jest.Mock };
  let service: RecruitmentEligibilityService;

  beforeEach(() => {
    character = {
      id: 'character-1',
      accountId: 'account-1',
      level: 65,
      factionId: FEDERATION,
    };
    account = { platformId: 'windows' };
    fleet = FLEET;
    visible = true;
    requireOwnedCharacter = jest.fn(() => Promise.resolve(character));
    manager = {
      findOne: jest.fn((entity: unknown) =>
        Promise.resolve(entity === StoFleetEntity ? fleet : account),
      ),
    };
    service = new RecruitmentEligibilityService(
      { requireOwnedCharacter } as unknown as CharacterFleetMembershipService,
      {
        canViewScope: jest.fn(() => Promise.resolve(visible)),
      } as unknown as FleetAudienceService,
    );
  });

  const em = (): EntityManager => manager as unknown as EntityManager;

  describe('loadFleet', () => {
    it('reads the Fleet with its Community and platform, in that Community', async () => {
      await expect(
        service.loadFleet(em(), 'community-1', 'fleet-1'),
      ).resolves.toBe(FLEET);
      expect(manager.findOne).toHaveBeenCalledWith(StoFleetEntity, {
        where: { id: 'fleet-1', communityId: 'community-1' },
        relations: { community: true, platform: true },
      });
    });

    it('refuses a Fleet that is not there', async () => {
      fleet = null;

      await expect(
        service.loadFleet(em(), 'community-1', 'fleet-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ['a closed Fleet', { ...FLEET, status: FleetScopeStatus.CLOSED }],
      [
        'a Fleet in a suspended Community',
        {
          ...FLEET,
          community: { ...FLEET.community, status: FleetScopeStatus.SUSPENDED },
        },
      ],
      ['a standalone Fleet', { ...FLEET, community: null }],
    ])('refuses %s', async (_label, candidate) => {
      fleet = candidate as StoFleetEntity;

      await expect(
        service.loadFleet(em(), 'community-1', 'fleet-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('assertVisible', () => {
    it('lets somebody who may see the Fleet through', async () => {
      await expect(
        service.assertVisible(FLEET, 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('treats a Fleet somebody may not see as missing', async () => {
      visible = false;

      await expect(
        service.assertVisible(FLEET, 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('asks about the Fleet itself', async () => {
      const canViewScope = jest.fn(() => Promise.resolve(true));
      service = new RecruitmentEligibilityService(
        { requireOwnedCharacter } as unknown as CharacterFleetMembershipService,
        { canViewScope } as unknown as FleetAudienceService,
      );

      await service.assertVisible(FLEET, 'user-1');

      expect(canViewScope).toHaveBeenCalledWith(
        { kind: FleetScopeKind.FLEET, id: 'fleet-1' },
        'user-1',
      );
    });
  });

  describe('assertNotOwner', () => {
    it('refuses the Community’s Owner', () => {
      expect(() => service.assertNotOwner(FLEET, 'owner-1')).toThrow(
        ConflictException,
      );
    });

    it('lets anyone else through', () => {
      expect(() => service.assertNotOwner(FLEET, 'user-1')).not.toThrow();
      expect(() =>
        service.assertNotOwner(
          { ...FLEET, community: null } as StoFleetEntity,
          'user-1',
        ),
      ).not.toThrow();
    });
  });

  describe('requireCharacter', () => {
    it('proves the Character is theirs, over a lock', async () => {
      await expect(
        service.requireCharacter(em(), FLEET, 'character-1', 'user-1', null),
      ).resolves.toBe(character);
      expect(requireOwnedCharacter).toHaveBeenCalledWith(
        em(),
        'character-1',
        'user-1',
        { lock: true },
      );
    });

    it('refuses a Character on another platform', async () => {
      account = { platformId: 'playstation' };

      await expect(
        service.requireCharacter(em(), FLEET, 'character-1', 'user-1', null),
      ).rejects.toThrow('plays on a different platform');
    });

    it('refuses a Character whose account has gone', async () => {
      account = null;

      await expect(
        service.requireCharacter(em(), FLEET, 'character-1', 'user-1', null),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets an invitation past the requirements', async () => {
      character.level = 10;

      await expect(
        service.requireCharacter(em(), FLEET, 'character-1', 'user-1', null),
      ).resolves.toBe(character);
    });

    it('holds a join or application to the minimum level', async () => {
      character.level = 49;

      await expect(
        service.requireCharacter(
          em(),
          FLEET,
          'character-1',
          'user-1',
          requirements({ minimumLevel: 50 }),
        ),
      ).rejects.toThrow(
        'This Fleet asks for Characters of level 50 or higher.',
      );
    });

    it('says to record a level the Character has never had', async () => {
      character.level = null as unknown as number;

      await expect(
        service.requireCharacter(
          em(),
          FLEET,
          'character-1',
          'user-1',
          requirements({ minimumLevel: 1 }),
        ),
      ).rejects.toThrow('Record your Character’s level on its page first.');
    });

    it('holds a join or application to the allowed factions', async () => {
      await expect(
        service.requireCharacter(
          em(),
          FLEET,
          'character-1',
          'user-1',
          requirements({ factionIds: ['faction-kdf'] }),
        ),
      ).rejects.toThrow('does not take Characters of that faction');
    });

    it('accepts a Character meeting every requirement', async () => {
      await expect(
        service.requireCharacter(
          em(),
          FLEET,
          'character-1',
          'user-1',
          requirements({ minimumLevel: 65, factionIds: [FEDERATION] }),
        ),
      ).resolves.toBe(character);
    });
  });
});
