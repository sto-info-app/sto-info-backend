import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { DataSource, EntityManager, EntityTarget } from 'typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { FleetAudienceService } from '../authorisation/fleet-audience.service';
import { CHARACTER_FLEET_PROPOSAL_EXPIRY_DAYS } from '../constants/fleet-policy.constants';
import { CharacterFleetMembershipEntity } from '../entities/character-fleet-membership.entity';
import { CharacterFleetProposalEntity } from '../entities/character-fleet-proposal.entity';
import { CharacterFleetMembershipSource } from '../enums/character-fleet-membership-source.enum';
import { CharacterFleetProposalStatus } from '../enums/character-fleet-proposal-status.enum';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { CharacterFleetMembershipService } from './character-fleet-membership.service';
import { CharacterFleetProposalService } from './character-fleet-proposal.service';

describe('CharacterFleetProposalService', () => {
  let service: CharacterFleetProposalService;
  let manager: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    exists: jest.Mock;
  };
  let audienceService: { canViewScope: jest.Mock };
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
  /** What findOne answers with for the Character table. */
  let character: Partial<CharacterEntity> | null;
  /** What findOne answers with for the account table. */
  let account: Partial<AccountEntity> | null;

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
      applicationId: null,
      ...overrides,
    });

  beforeEach(async () => {
    stored = proposal();
    character = { id: characterId, accountId: 'account-1' };
    account = { id: 'account-1', userId: ownerId };

    manager = {
      find: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn((entity: EntityTarget<unknown>) =>
        Promise.resolve(
          entity === CharacterEntity
            ? character
            : entity === AccountEntity
              ? account
              : stored,
        ),
      ),
      exists: jest.fn(() => Promise.resolve(false)),
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

    audienceService = {
      canViewScope: jest.fn(() => Promise.resolve(true)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterFleetProposalService,
        { provide: FleetAudienceService, useValue: audienceService },
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

      await expect(service.listForOwner(characterId, ownerId)).resolves.toEqual(
        rows,
      );
      expect(manager.find).toHaveBeenCalledWith(
        CharacterFleetProposalEntity,
        expect.objectContaining({ order: { raisedAt: 'DESC' } }),
      );
    });

    /**
     * Anybody can register a Character under any name, so a question from a
     * Fleet its owner cannot see would tell them which hidden Fleet lists it.
     * An answered one stays, because they answered it knowing.
     */
    it('leaves out an unanswered one from a Fleet the owner cannot see', async () => {
      const hidden = proposal({ id: 'hidden', fleetId: 'fleet-hidden' });
      const lapsed = proposal({
        id: 'lapsed',
        fleetId: 'fleet-hidden',
        status: CharacterFleetProposalStatus.LAPSED,
      });
      const answered = proposal({
        id: 'answered',
        fleetId: 'fleet-hidden',
        status: CharacterFleetProposalStatus.DECLINED,
        answeredAt: new Date('2026-02-01Z'),
      });
      const shown = proposal({ id: 'shown' });

      manager.find.mockResolvedValueOnce([hidden, lapsed, answered, shown]);
      audienceService.canViewScope.mockImplementation((ref: { id: string }) =>
        Promise.resolve(ref.id !== 'fleet-hidden'),
      );

      await expect(service.listForOwner(characterId, ownerId)).resolves.toEqual(
        [answered, shown],
      );
    });

    it('asks once per Fleet, as the owner', async () => {
      manager.find.mockResolvedValueOnce([
        proposal({ id: 'one' }),
        proposal({ id: 'two' }),
      ]);

      await service.listForOwner(characterId, ownerId);

      expect(audienceService.canViewScope).toHaveBeenCalledTimes(1);
      expect(audienceService.canViewScope).toHaveBeenCalledWith(
        { kind: FleetScopeKind.FLEET, id: fleetId },
        ownerId,
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

    it('cites the accepted application that raised it', async () => {
      stored = null;

      const raised = await service.raise(
        characterId,
        { fleetId, applicationId: 'application-1' },
        now,
      );

      expect(raised).toMatchObject({ applicationId: 'application-1' });
    });

    /**
     * An acceptance landing on a question the roster already asked makes it
     * the application's question too, so a confirmation is recorded as
     * coming from the application.
     */
    it('makes an open question from the roster the application’s too', async () => {
      const open = proposal({ evidenceImportId: 'import-1' });

      stored = open;

      await service.raise(
        characterId,
        { fleetId, applicationId: 'application-1' },
        now,
      );

      expect(manager.save).toHaveBeenCalledWith(
        CharacterFleetProposalEntity,
        expect.objectContaining({
          id: 'proposal-1',
          applicationId: 'application-1',
          evidenceImportId: 'import-1',
        }),
      );
    });

    it('leaves an open question that already has an application alone', async () => {
      const open = proposal({ applicationId: 'application-0' });

      stored = open;

      await expect(
        service.raise(
          characterId,
          { fleetId, applicationId: 'application-1' },
          now,
        ),
      ).resolves.toBe(open);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('cites the import it rests on', async () => {
      stored = null;

      const raised = await service.raise(
        characterId,
        { fleetId, evidenceImportId: 'import-1' },
        now,
      );

      expect(raised).toMatchObject({
        evidenceImportId: 'import-1',
        replacesProposalId: null,
      });
    });

    /**
     * An expired proposal was never answered, so the next import may ask
     * again. The old one has to stop being PENDING first, or the unique index
     * would refuse the new one, and it is kept so the owner can see it was
     * asked before.
     */
    it('lapses an expired open one and asks again in its place', async () => {
      const expired = proposal({
        id: 'expired',
        expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      stored = expired;

      const raised = await service.raise(characterId, { fleetId }, now);

      expect(manager.save).toHaveBeenNthCalledWith(
        1,
        CharacterFleetProposalEntity,
        expect.objectContaining({
          id: 'expired',
          status: CharacterFleetProposalStatus.LAPSED,
          answeredAt: null,
        }),
      );
      expect(raised).toMatchObject({
        status: CharacterFleetProposalStatus.PENDING,
        replacesProposalId: 'expired',
        raisedAt: now,
      });
    });

    it('takes its own instant when none is given', async () => {
      stored = null;

      const raised = await service.raise(characterId, { fleetId });

      expect(raised.raisedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('raising one inside somebody else’s transaction', () => {
    it('writes through the manager it was given', async () => {
      stored = null;
      const outer = {
        findOne: jest.fn(() => Promise.resolve(null)),
        create: jest.fn((_entity: unknown, input: object) =>
          Object.assign(new CharacterFleetProposalEntity(), input),
        ),
        save: jest.fn((_entity: unknown, row: object) => Promise.resolve(row)),
      };

      const raised = await service.raiseWithin(
        outer as unknown as EntityManager,
        characterId,
        { fleetId, applicationId: 'application-1' },
        now,
      );

      expect(raised).toMatchObject({ applicationId: 'application-1' });
      expect(outer.save).toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('takes its own instant when none is given', async () => {
      stored = null;

      const raised = await service.raiseWithin(
        manager as unknown as EntityManager,
        characterId,
        { fleetId },
      );

      expect(raised.raisedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('raising one from roster evidence', () => {
    const observedAt = new Date('2026-02-20T12:00:00.000Z');
    const evidence = { fleetId, evidenceImportId: 'import-1', observedAt };

    beforeEach(() => {
      stored = null;
    });

    it('raises one citing the import and when its export was taken', async () => {
      const raised = await service.raiseFromEvidence(
        characterId,
        evidence,
        now,
      );

      expect(raised).toMatchObject({
        characterId,
        fleetId,
        evidenceImportId: 'import-1',
        observedAt,
        proposedByUserId: null,
        status: CharacterFleetProposalStatus.PENDING,
      });
    });

    it('locks the Character, as an answer does', async () => {
      await service.raiseFromEvidence(characterId, evidence, now);

      expect(manager.findOne).toHaveBeenCalledWith(CharacterEntity, {
        where: { id: characterId },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('asks whether the owner could see the Fleet anyway', async () => {
      await service.raiseFromEvidence(characterId, evidence, now);

      expect(audienceService.canViewScope).toHaveBeenCalledWith(
        { kind: FleetScopeKind.FLEET, id: fleetId },
        ownerId,
      );
    });

    it.each([
      [
        'the Character is gone',
        (): void => {
          character = null;
        },
      ],
      [
        'its account is gone',
        (): void => {
          account = null;
        },
      ],
      [
        'the owner could not see the Fleet',
        (): void => {
          audienceService.canViewScope.mockResolvedValue(false);
        },
      ],
      [
        'the owner declined this Fleet before',
        (): void => {
          manager.exists.mockImplementation((entity: EntityTarget<unknown>) =>
            Promise.resolve(entity === CharacterFleetProposalEntity),
          );
        },
      ],
      [
        'the owner has recorded a membership of this Fleet',
        (): void => {
          manager.exists.mockImplementation((entity: EntityTarget<unknown>) =>
            Promise.resolve(entity === CharacterFleetMembershipEntity),
          );
        },
      ],
    ])('asks nothing when %s', async (_case, arrange) => {
      arrange();

      await expect(
        service.raiseFromEvidence(characterId, evidence, now),
      ).resolves.toBeNull();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('looks for a decline from this Fleet only', async () => {
      await service.raiseFromEvidence(characterId, evidence, now);

      expect(manager.exists).toHaveBeenCalledWith(
        CharacterFleetProposalEntity,
        {
          where: {
            characterId,
            fleetId,
            status: CharacterFleetProposalStatus.DECLINED,
          },
        },
      );
    });

    // An ended membership counts, and so does one the owner removed: either
    // way it is their own statement about this Fleet.
    it('counts every membership of this Fleet, ended or removed', async () => {
      await service.raiseFromEvidence(characterId, evidence, now);

      expect(manager.exists).toHaveBeenCalledWith(
        CharacterFleetMembershipEntity,
        { where: { characterId, fleetId }, withDeleted: true },
      );
    });

    it('returns the open one rather than asking twice', async () => {
      const open = proposal();

      stored = open;

      await expect(
        service.raiseFromEvidence(characterId, evidence, now),
      ).resolves.toBe(open);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('takes its own instant when none is given', async () => {
      const raised = await service.raiseFromEvidence(characterId, evidence);

      expect(raised!.raisedAt.getTime()).toBeLessThanOrEqual(Date.now());
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

  describe('accepting one an application raised', () => {
    it('records the membership as coming from the application', async () => {
      stored = proposal({ applicationId: 'application-1' });

      await service.accept(characterId, 'proposal-1', ownerId, {}, now);

      expect(membershipService.openWithin).toHaveBeenCalledWith(
        manager,
        characterId,
        expect.objectContaining({ fleetId, validFrom: now }),
        expect.objectContaining({
          source: CharacterFleetMembershipSource.APPLICATION,
          proposalId: 'proposal-1',
        }),
      );
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
    /**
     * Reported the same as one that does not exist, so that answering it
     * cannot be used to learn which hidden Fleet it came from.
     */
    it('reports one from a Fleet the owner cannot now see as missing', async () => {
      audienceService.canViewScope.mockResolvedValue(false);

      await expect(
        service.accept(characterId, 'proposal-1', ownerId, {}, now),
      ).rejects.toThrow(NotFoundException);
      expect(audienceService.canViewScope).toHaveBeenCalledWith(
        { kind: FleetScopeKind.FLEET, id: fleetId },
        ownerId,
      );
      expect(membershipService.openWithin).not.toHaveBeenCalled();
    });

    it('does not ask about a Fleet for one already answered', async () => {
      stored = proposal({
        status: CharacterFleetProposalStatus.DECLINED,
        answeredAt: new Date('2026-02-01Z'),
      });

      await expect(
        service.decline(characterId, 'proposal-1', ownerId, now),
      ).rejects.toThrow(ConflictException);
      expect(audienceService.canViewScope).not.toHaveBeenCalled();
    });

    it('refuses a lapsed one as expired', async () => {
      stored = proposal({ status: CharacterFleetProposalStatus.LAPSED });

      await expect(
        service.decline(characterId, 'proposal-1', ownerId, now),
      ).rejects.toThrow(/expired on/);
    });

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
