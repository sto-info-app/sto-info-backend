import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { DataSource, EntityTarget } from 'typeorm';

import { CHARACTER_FLEET_PROPOSAL_EXPIRY_DAYS } from '../constants/fleet-policy.constants';
import { CharacterFleetMembershipEntity } from '../entities/character-fleet-membership.entity';
import { CharacterFleetProposalEntity } from '../entities/character-fleet-proposal.entity';
import { CharacterFleetMembershipSource } from '../enums/character-fleet-membership-source.enum';
import { CharacterFleetProposalStatus } from '../enums/character-fleet-proposal-status.enum';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { CharacterFleetMembershipService } from './character-fleet-membership.service';
import { CharacterFleetProposalService } from './character-fleet-proposal.service';

describe('CharacterFleetProposalService', () => {
  let service: CharacterFleetProposalService;
  let manager: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let membershipService: {
    requireOwnedCharacter: jest.Mock;
    openWithin: jest.Mock;
  };

  const characterId = 'character-1';
  const ownerId = 'user-1';
  const fleetId = 'fleet-1';
  const now = new Date('2026-03-01T00:00:00.000Z');

  /** What findOne answers with for the proposal table. */
  let stored: CharacterFleetProposalEntity | null;

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
      characterId,
      fleetId,
      status: CharacterFleetProposalStatus.PENDING,
      observedAt: null,
      raisedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      proposedByUserId: null,
      answeredAt: null,
      answeredByUserId: null,
      ...overrides,
    });

  beforeEach(async () => {
    stored = proposal();

    manager = {
      find: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(() => Promise.resolve(stored)),
      save: jest.fn((_entity, row) => Promise.resolve(row)),
      create: jest.fn((entity: EntityTarget<unknown>, input) =>
        entity === CharacterFleetProposalEntity
          ? Object.assign(new CharacterFleetProposalEntity(), input)
          : input,
      ),
    };

    membershipService = {
      requireOwnedCharacter: jest.fn(() =>
        Promise.resolve({ id: characterId }),
      ),
      openWithin: jest.fn(() =>
        Promise.resolve(
          Object.assign(new CharacterFleetMembershipEntity(), {
            id: 'membership-1',
          }),
        ),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterFleetProposalService,
        {
          provide: CharacterFleetMembershipService,
          useValue: membershipService,
        },
        {
          provide: DataSource,
          useValue: {
            manager,
            transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
              work(manager),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(CharacterFleetProposalService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('reading them', () => {
    it('proves the Character is the caller’s before answering', async () => {
      await service.listForOwner(characterId, ownerId);

      expect(membershipService.requireOwnedCharacter).toHaveBeenCalledWith(
        manager,
        characterId,
        ownerId,
      );
    });

    /**
     * Answered proposals are returned too. A declined one explains why a Fleet
     * the owner recognises is missing from their history; without it, the only
     * evidence of the question is its absence.
     */
    it('returns every proposal, newest first', async () => {
      const rows = [proposal({ id: 'newer' }), proposal({ id: 'older' })];

      manager.find.mockResolvedValueOnce(rows);

      await expect(service.listForOwner(characterId, ownerId)).resolves.toBe(
        rows,
      );
      expect(manager.find).toHaveBeenCalledWith(
        CharacterFleetProposalEntity,
        expect.objectContaining({ order: { raisedAt: 'DESC' } }),
      );
    });
  });

  describe('raising one', () => {
    it('dates the deadline from the published window', async () => {
      stored = null;

      const raised = await service.raise(characterId, { fleetId }, now);

      expect(raised.expiresAt).toEqual(
        new Date(
          now.getTime() +
            CHARACTER_FLEET_PROPOSAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
        ),
      );
      expect(raised.raisedAt).toBe(now);
    });

    it('carries what the evidence said and who raised it', async () => {
      stored = null;

      const observedAt = new Date('2026-02-01T00:00:00.000Z');
      const raised = await service.raise(
        characterId,
        { fleetId, observedAt, proposedByUserId: 'officer-1' },
        now,
      );

      expect(raised).toMatchObject({
        observedAt,
        proposedByUserId: 'officer-1',
        status: CharacterFleetProposalStatus.PENDING,
      });
    });

    it('leaves both blank for an import nobody raised by hand', async () => {
      stored = null;

      const raised = await service.raise(characterId, { fleetId }, now);

      expect(raised.observedAt).toBeNull();
      expect(raised.proposedByUserId).toBeNull();
    });

    /**
     * A Fleet importing its roster weekly would otherwise ask the same
     * question every week, and fifty copies of one question is a way of making
     * sure none of them is read.
     */
    it('returns the open one rather than asking twice', async () => {
      const open = proposal();

      stored = open;

      await expect(service.raise(characterId, { fleetId }, now)).resolves.toBe(
        open,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('takes its own instant when none is given', async () => {
      stored = null;

      const raised = await service.raise(characterId, { fleetId });

      expect(raised.raisedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('accepting one', () => {
    it('records the answer and who gave it', async () => {
      await service.accept(characterId, 'proposal-1', ownerId, {}, now);

      expect(manager.save).toHaveBeenCalledWith(
        CharacterFleetProposalEntity,
        expect.objectContaining({
          status: CharacterFleetProposalStatus.ACCEPTED,
          answeredAt: now,
          answeredByUserId: ownerId,
        }),
      );
    });

    /**
     * The only place a membership is written with CONFIRMED_IMPORT, and it
     * cites the proposal — which the database insists on, so a claim of
     * roster evidence always has the question behind it.
     */
    it('opens the membership it was proposing, citing the proposal', async () => {
      await service.accept(characterId, 'proposal-1', ownerId, {}, now);

      expect(membershipService.openWithin).toHaveBeenCalledWith(
        manager,
        characterId,
        expect.objectContaining({ fleetId }),
        {
          source: CharacterFleetMembershipSource.CONFIRMED_IMPORT,
          proposalId: 'proposal-1',
          actorUserId: ownerId,
        },
      );
    });

    /**
     * An export taken in March, imported in April and confirmed in May
     * describes a Fleet somebody was in from March. Dating the membership from
     * the confirmation would record a join that did not happen.
     */
    it('begins the membership when the evidence says, not when it was answered', async () => {
      const observedAt = new Date('2026-01-15T00:00:00.000Z');

      stored = proposal({ observedAt });

      await service.accept(characterId, 'proposal-1', ownerId, {}, now);

      expect(membershipService.openWithin).toHaveBeenCalledWith(
        manager,
        characterId,
        expect.objectContaining({ validFrom: observedAt }),
        expect.anything(),
      );
    });

    it('falls back to now where the evidence gave no instant', async () => {
      await service.accept(characterId, 'proposal-1', ownerId, {}, now);

      expect(membershipService.openWithin).toHaveBeenCalledWith(
        manager,
        characterId,
        expect.objectContaining({ validFrom: now }),
        expect.anything(),
      );
    });

    it('settles the audience at the moment the membership exists', async () => {
      await service.accept(
        characterId,
        'proposal-1',
        ownerId,
        { visibility: FleetAudience.COMMUNITY },
        now,
      );

      expect(membershipService.openWithin).toHaveBeenCalledWith(
        manager,
        characterId,
        expect.objectContaining({ visibility: FleetAudience.COMMUNITY }),
        expect.anything(),
      );
    });

    it('locks the Character for the answer and the membership together', async () => {
      await service.accept(characterId, 'proposal-1', ownerId, {}, now);

      expect(membershipService.requireOwnedCharacter).toHaveBeenCalledWith(
        manager,
        characterId,
        ownerId,
        { lock: true },
      );
    });

    it('takes its own instant when none is given', async () => {
      await service.accept(characterId, 'proposal-1', ownerId);

      expect(membershipService.openWithin).toHaveBeenCalled();
    });
  });

  describe('declining one', () => {
    it('records the answer without opening anything', async () => {
      const declined = await service.decline(
        characterId,
        'proposal-1',
        ownerId,
        now,
      );

      expect(declined).toMatchObject({
        status: CharacterFleetProposalStatus.DECLINED,
        answeredAt: now,
        answeredByUserId: ownerId,
      });
      expect(membershipService.openWithin).not.toHaveBeenCalled();
    });

    it('takes its own instant when none is given', async () => {
      const declined = await service.decline(
        characterId,
        'proposal-1',
        ownerId,
      );

      expect(declined.answeredAt).not.toBeNull();
    });
  });

  describe('refusing an answer it will not take', () => {
    it('reports a proposal that is not this Character’s', async () => {
      stored = null;

      await expect(
        service.decline(characterId, 'somebody-elses', ownerId, now),
      ).rejects.toThrow(NotFoundException);
      expect(manager.findOne).toHaveBeenCalledWith(
        CharacterFleetProposalEntity,
        expect.objectContaining({
          where: { id: 'somebody-elses', characterId },
        }),
      );
    });

    /**
     * Expired is refused with its deadline rather than reported missing. It is
     * not missing — somebody is looking at it — and "not found" would send them
     * hunting for a bug instead of telling them what happened.
     */
    it('refuses an expired one and names the deadline', async () => {
      stored = proposal({ expiresAt: new Date('2026-02-01T00:00:00.000Z') });

      await expect(
        service.accept(characterId, 'proposal-1', ownerId, {}, now),
      ).rejects.toThrow(/expired on 2026-02-01T00:00:00.000Z/);
    });

    it.each([
      [CharacterFleetProposalStatus.ACCEPTED, 'accepted'],
      [CharacterFleetProposalStatus.DECLINED, 'declined'],
    ])('refuses one already %s', async (status, word) => {
      stored = proposal({ status, answeredAt: new Date('2026-02-01Z') });

      await expect(
        service.decline(characterId, 'proposal-1', ownerId, now),
      ).rejects.toThrow(new RegExp(`already been ${word}`));
    });

    it('answers a conflict rather than a bad request', async () => {
      stored = proposal({
        status: CharacterFleetProposalStatus.ACCEPTED,
        answeredAt: new Date('2026-02-01Z'),
      });

      await expect(
        service.accept(characterId, 'proposal-1', ownerId, {}, now),
      ).rejects.toThrow(ConflictException);
    });
  });
});
