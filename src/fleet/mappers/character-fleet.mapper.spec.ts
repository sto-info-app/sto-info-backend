import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { CharacterFleetMembershipEntity } from '../entities/character-fleet-membership.entity';
import { CharacterFleetProposalEntity } from '../entities/character-fleet-proposal.entity';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { CharacterFleetMembershipSource } from '../enums/character-fleet-membership-source.enum';
import {
  CharacterFleetProposalState,
  CharacterFleetProposalStatus,
} from '../enums/character-fleet-proposal-status.enum';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { CharacterFleetMapper } from './character-fleet.mapper';

describe('CharacterFleetMapper', () => {
  const mapper = new CharacterFleetMapper();

  /**
   * Builds the Fleet a membership or proposal names.
   *
   * @param overrides - Fields to change.
   * @returns The Fleet.
   */
  const fleet = (overrides: Partial<StoFleetEntity> = {}): StoFleetEntity =>
    Object.assign(new StoFleetEntity(), {
      id: 'fleet-1',
      exactGameName: 'Sol Defence Force',
      slug: 'sol-defence-force',
      platform: Object.assign(new PlatformEntity(), { name: 'Windows' }),
      community: Object.assign(new FleetCommunityEntity(), {
        name: 'Sol Command',
        slug: 'sol-command',
      }),
      ...overrides,
    });

  describe('the Fleet a record names', () => {
    it('says enough to recognise it and to link to it', () => {
      expect(mapper.toSummaryDto(fleet())).toEqual({
        id: 'fleet-1',
        exactGameName: 'Sol Defence Force',
        slug: 'sol-defence-force',
        platformName: 'Windows',
        platformSegment: 'windows',
        communityName: 'Sol Command',
        communitySlug: 'sol-command',
      });
    });

    /**
     * A Fleet nobody here runs has no Community to name. The pair reads as
     * null rather than as the reserved segment, because the segment is an
     * address and this is a name.
     */
    it('says nothing where there is no Community', () => {
      const summary = mapper.toSummaryDto(fleet({ community: null }));

      expect(summary.communityName).toBeNull();
      expect(summary.communitySlug).toBeNull();
    });
  });

  describe('a membership', () => {
    it('maps exactly the fields the owner is given', () => {
      const membership = Object.assign(new CharacterFleetMembershipEntity(), {
        id: 'membership-1',
        characterId: 'character-1',
        fleet: fleet(),
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: null,
        source: CharacterFleetMembershipSource.CONFIRMED_IMPORT,
        visibility: FleetAudience.FLEET_MEMBERS,
        proposalId: 'proposal-1',
        recordedAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      expect(mapper.toMembershipDto(membership)).toEqual({
        id: 'membership-1',
        characterId: 'character-1',
        fleet: mapper.toSummaryDto(fleet()),
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: null,
        source: CharacterFleetMembershipSource.CONFIRMED_IMPORT,
        visibility: FleetAudience.FLEET_MEMBERS,
        proposalId: 'proposal-1',
        recordedAt: new Date('2026-01-02T00:00:00.000Z'),
      });
    });

    /**
     * The actor, the soft-delete marker and the timestamps stay behind. A
     * column added to the entity later is private until somebody decides
     * otherwise, which matters most on the table holding somebody's history.
     */
    it('leaves the columns nobody asked for behind', () => {
      const membership = Object.assign(new CharacterFleetMembershipEntity(), {
        id: 'membership-1',
        characterId: 'character-1',
        fleet: fleet(),
        validFrom: new Date('2026-01-01Z'),
        validTo: null,
        source: CharacterFleetMembershipSource.MANUAL,
        visibility: FleetAudience.PRIVATE,
        proposalId: null,
        recordedAt: new Date('2026-01-01Z'),
        actorUserId: 'user-1',
        deletedAt: null,
        createdAt: new Date('2026-01-01Z'),
        updatedAt: new Date('2026-01-01Z'),
      });

      expect(Object.keys(mapper.toMembershipDto(membership))).not.toEqual(
        expect.arrayContaining([
          'actorUserId',
          'deletedAt',
          'createdAt',
          'updatedAt',
        ]),
      );
    });
  });

  describe('a proposal', () => {
    /**
     * Builds a proposal row.
     *
     * @param overrides - Fields to change.
     * @returns The proposal.
     */
    const proposal = (
      overrides: Partial<CharacterFleetProposalEntity> = {},
    ): CharacterFleetProposalEntity =>
      Object.assign(new CharacterFleetProposalEntity(), {
        id: 'proposal-1',
        characterId: 'character-1',
        fleet: fleet(),
        status: CharacterFleetProposalStatus.PENDING,
        observedAt: new Date('2026-01-01T00:00:00.000Z'),
        raisedAt: new Date('2026-01-02T00:00:00.000Z'),
        expiresAt: new Date('2026-04-02T00:00:00.000Z'),
        answeredAt: null,
        ...overrides,
      });

    it('reports where it stands rather than its stored status', () => {
      const dto = mapper.toProposalDto(
        proposal(),
        new Date('2026-02-01T00:00:00.000Z'),
      );

      expect(dto).toEqual({
        id: 'proposal-1',
        characterId: 'character-1',
        fleet: mapper.toSummaryDto(fleet()),
        state: CharacterFleetProposalState.PENDING,
        observedAt: new Date('2026-01-01T00:00:00.000Z'),
        raisedAt: new Date('2026-01-02T00:00:00.000Z'),
        expiresAt: new Date('2026-04-02T00:00:00.000Z'),
        answeredAt: null,
        fromApplication: false,
      });
    });

    it('says when an accepted application raised it, without naming it', () => {
      const dto = mapper.toProposalDto(
        proposal({ applicationId: 'application-1' }),
      );

      expect(dto.fromApplication).toBe(true);
      expect(dto).not.toHaveProperty('applicationId');
    });

    /**
     * The one outcome nobody chose. A reader should not have to compare the
     * deadline themselves to find out the question has closed.
     */
    it('says a lapsed one is expired without anything having swept it', () => {
      const dto = mapper.toProposalDto(
        proposal(),
        new Date('2026-06-01T00:00:00.000Z'),
      );

      expect(dto.state).toBe(CharacterFleetProposalState.EXPIRED);
    });

    it('judges the deadline against now when no instant is given', () => {
      const dto = mapper.toProposalDto(
        proposal({ expiresAt: new Date('2000-01-01Z') }),
      );

      expect(dto.state).toBe(CharacterFleetProposalState.EXPIRED);
    });

    it('never says who proposed it', () => {
      const dto = mapper.toProposalDto(
        proposal({ proposedByUserId: 'officer-1' }),
        new Date('2026-02-01Z'),
      );

      expect(Object.keys(dto)).not.toContain('proposedByUserId');
    });
  });
});
