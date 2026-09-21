import { NotFoundException } from '@nestjs/common';

import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { CharacterFleetsController } from './character-fleets.controller';
import { CharacterFleetMembershipEntity } from './entities/character-fleet-membership.entity';
import { CharacterFleetProposalEntity } from './entities/character-fleet-proposal.entity';
import { StoFleetEntity } from './entities/sto-fleet.entity';
import { CharacterFleetMembershipSource } from './enums/character-fleet-membership-source.enum';
import { CharacterFleetProposalStatus } from './enums/character-fleet-proposal-status.enum';
import { FleetAudience } from './enums/fleet-audience.enum';
import { FleetFeatureService } from './fleet-feature.service';
import { CharacterFleetMapper } from './mappers/character-fleet.mapper';
import { CharacterFleetMembershipService } from './services/character-fleet-membership.service';
import { CharacterFleetProposalService } from './services/character-fleet-proposal.service';

describe('CharacterFleetsController', () => {
  let controller: CharacterFleetsController;
  let membershipService: {
    listForOwner: jest.Mock;
    record: jest.Mock;
    leave: jest.Mock;
    retract: jest.Mock;
    setVisibility: jest.Mock;
  };
  let proposalService: {
    listForOwner: jest.Mock;
    accept: jest.Mock;
    decline: jest.Mock;
  };
  let featureService: { assertEnabled: jest.Mock };

  const characterId = '11111111-1111-4111-8111-111111111111';
  const ownerId = 'user-1';

  const fleet = Object.assign(new StoFleetEntity(), {
    id: 'fleet-1',
    exactGameName: 'Sol Defence Force',
    slug: 'sol-defence-force',
    platform: Object.assign(new PlatformEntity(), { name: 'Windows' }),
    community: null,
  });

  const membership = Object.assign(new CharacterFleetMembershipEntity(), {
    id: 'membership-1',
    characterId,
    fleet,
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validTo: null,
    source: CharacterFleetMembershipSource.MANUAL,
    visibility: FleetAudience.PRIVATE,
    proposalId: null,
    recordedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  const proposal = Object.assign(new CharacterFleetProposalEntity(), {
    id: 'proposal-1',
    characterId,
    fleet,
    status: CharacterFleetProposalStatus.PENDING,
    observedAt: null,
    raisedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    answeredAt: null,
  });

  beforeEach(() => {
    membershipService = {
      listForOwner: jest.fn(() => Promise.resolve([membership])),
      record: jest.fn(() => Promise.resolve(membership)),
      leave: jest.fn(() => Promise.resolve(membership)),
      retract: jest.fn(() => Promise.resolve(undefined)),
      setVisibility: jest.fn(() => Promise.resolve(membership)),
    };
    proposalService = {
      listForOwner: jest.fn(() => Promise.resolve([proposal])),
      accept: jest.fn(() => Promise.resolve(membership)),
      decline: jest.fn(() => Promise.resolve(proposal)),
    };
    featureService = { assertEnabled: jest.fn(() => Promise.resolve()) };

    controller = new CharacterFleetsController(
      membershipService as unknown as CharacterFleetMembershipService,
      proposalService as unknown as CharacterFleetProposalService,
      featureService as unknown as FleetFeatureService,
      new CharacterFleetMapper(),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  /**
   * The whole feature switch rather than a capability flag, and it is asked
   * first. Personal tracking is not a staged capability in its own right —
   * there is no world in which Fleet Community is on and this is off.
   */
  describe('the feature switch', () => {
    it.each([
      [
        'the history',
        () => controller.history(characterId, ownerId),
        () => membershipService.listForOwner,
      ],
      [
        'recording one',
        () =>
          controller.record(
            characterId,
            { fleetId: 'fleet-1', validFrom: '2026-01-01T00:00:00.000Z' },
            ownerId,
          ),
        () => membershipService.record,
      ],
      [
        'leaving',
        () => controller.leave(characterId, {}, ownerId),
        () => membershipService.leave,
      ],
      [
        'the visibility change',
        () =>
          controller.setVisibility(
            characterId,
            'membership-1',
            { visibility: FleetAudience.PUBLIC },
            ownerId,
          ),
        () => membershipService.setVisibility,
      ],
      [
        'withdrawing one',
        () => controller.retract(characterId, 'membership-1', ownerId),
        () => membershipService.retract,
      ],
      [
        'the proposals',
        () => controller.proposals(characterId, ownerId),
        () => proposalService.listForOwner,
      ],
      [
        'accepting one',
        () => controller.accept(characterId, 'proposal-1', {}, ownerId),
        () => proposalService.accept,
      ],
      [
        'declining one',
        () => controller.decline(characterId, 'proposal-1', ownerId),
        () => proposalService.decline,
      ],
    ])(
      'hides %s when the feature is switched off',
      async (_name, call, mock) => {
        featureService.assertEnabled.mockRejectedValueOnce(
          new NotFoundException('Not found'),
        );

        await expect(call()).rejects.toThrow(NotFoundException);
        expect(mock()).not.toHaveBeenCalled();
      },
    );
  });

  describe('the history', () => {
    it('returns the owner’s own memberships', async () => {
      await expect(controller.history(characterId, ownerId)).resolves.toEqual([
        expect.objectContaining({ id: 'membership-1' }),
      ]);
      expect(membershipService.listForOwner).toHaveBeenCalledWith(
        characterId,
        ownerId,
      );
    });
  });

  describe('recording a membership', () => {
    it('passes the interval on as instants', async () => {
      await controller.record(
        characterId,
        {
          fleetId: 'fleet-1',
          validFrom: '2026-01-01T00:00:00.000Z',
          validTo: '2026-06-01T00:00:00.000Z',
          visibility: FleetAudience.COMMUNITY,
        },
        ownerId,
      );

      expect(membershipService.record).toHaveBeenCalledWith(
        characterId,
        ownerId,
        {
          fleetId: 'fleet-1',
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: new Date('2026-06-01T00:00:00.000Z'),
          visibility: FleetAudience.COMMUNITY,
        },
      );
    });

    /**
     * Leaving `validTo` out is what makes it a current membership, and the
     * only difference between the two requests.
     */
    it.each([
      ['left out', undefined],
      ['sent as null', null],
    ])(
      'opens a current membership when validTo is %s',
      async (_name, validTo) => {
        await controller.record(
          characterId,
          {
            fleetId: 'fleet-1',
            validFrom: '2026-01-01T00:00:00.000Z',
            validTo,
          },
          ownerId,
        );

        expect(membershipService.record).toHaveBeenCalledWith(
          characterId,
          ownerId,
          expect.objectContaining({ validTo: null }),
        );
      },
    );
  });

  describe('leaving a Fleet', () => {
    it('uses the instant given', async () => {
      await controller.leave(
        characterId,
        { validTo: '2026-06-01T00:00:00.000Z' },
        ownerId,
      );

      expect(membershipService.leave).toHaveBeenCalledWith(
        characterId,
        ownerId,
        new Date('2026-06-01T00:00:00.000Z'),
      );
    });

    /**
     * Somebody recording that they have left a Fleet has almost always just
     * left it, so the ordinary request carries no date at all.
     */
    it('means now when none is given', async () => {
      const before = Date.now();

      await controller.leave(characterId, {}, ownerId);

      const [, , validTo] = membershipService.leave.mock.calls[0] as [
        string,
        string,
        Date,
      ];

      expect(validTo.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('the two removals', () => {
    it('changes who may see one without touching the rest', async () => {
      await controller.setVisibility(
        characterId,
        'membership-1',
        { visibility: FleetAudience.PUBLIC },
        ownerId,
      );

      expect(membershipService.setVisibility).toHaveBeenCalledWith(
        characterId,
        'membership-1',
        ownerId,
        FleetAudience.PUBLIC,
      );
    });

    it('withdraws one recorded in error', async () => {
      await expect(
        controller.retract(characterId, 'membership-1', ownerId),
      ).resolves.toBeUndefined();
      expect(membershipService.retract).toHaveBeenCalledWith(
        characterId,
        'membership-1',
        ownerId,
      );
    });
  });

  describe('proposals', () => {
    it('returns them with expiry already worked out', async () => {
      await expect(controller.proposals(characterId, ownerId)).resolves.toEqual(
        [expect.objectContaining({ id: 'proposal-1', state: 'PENDING' })],
      );
    });

    it('answers an acceptance with the membership it opened', async () => {
      await expect(
        controller.accept(
          characterId,
          'proposal-1',
          { visibility: FleetAudience.FLEET_MEMBERS },
          ownerId,
        ),
      ).resolves.toEqual(expect.objectContaining({ id: 'membership-1' }));
      expect(proposalService.accept).toHaveBeenCalledWith(
        characterId,
        'proposal-1',
        ownerId,
        { visibility: FleetAudience.FLEET_MEMBERS },
      );
    });

    it('answers a decline with the proposal', async () => {
      await expect(
        controller.decline(characterId, 'proposal-1', ownerId),
      ).resolves.toEqual(expect.objectContaining({ id: 'proposal-1' }));
    });
  });
});
