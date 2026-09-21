import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { DataSource, EntityTarget } from 'typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { CharacterFleetMembershipEntity } from '../entities/character-fleet-membership.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { CharacterFleetMembershipSource } from '../enums/character-fleet-membership-source.enum';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { CharacterFleetMembershipService } from './character-fleet-membership.service';

describe('CharacterFleetMembershipService', () => {
  let service: CharacterFleetMembershipService;
  let manager: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    softRemove: jest.Mock;
  };

  const characterId = 'character-1';
  const ownerId = 'user-1';
  const fleetId = 'fleet-1';

  /** What each entity's findOne answers with, keyed by the class asked for. */
  let answers: Map<unknown, unknown>;

  /** Every live membership the Character has, as openWithin reads them. */
  let existing: CharacterFleetMembershipEntity[];

  /**
   * Builds a membership row.
   *
   * @param overrides - Fields to change.
   * @returns The membership.
   */
  const membership = (
    overrides: Partial<CharacterFleetMembershipEntity> = {},
  ): CharacterFleetMembershipEntity =>
    Object.assign(new CharacterFleetMembershipEntity(), {
      id: 'membership-1',
      characterId,
      fleetId,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validTo: null,
      source: CharacterFleetMembershipSource.MANUAL,
      proposalId: null,
      visibility: FleetAudience.PRIVATE,
      actorUserId: ownerId,
      recordedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    });

  beforeEach(async () => {
    existing = [];
    answers = new Map<unknown, unknown>([
      [
        CharacterEntity,
        Object.assign(new CharacterEntity(), {
          id: characterId,
          accountId: 'account-1',
        }),
      ],
      [
        AccountEntity,
        Object.assign(new AccountEntity(), {
          id: 'account-1',
          userId: ownerId,
        }),
      ],
      [StoFleetEntity, Object.assign(new StoFleetEntity(), { id: fleetId })],
      [CharacterFleetMembershipEntity, null],
    ]);

    manager = {
      find: jest.fn(() => Promise.resolve(existing)),
      findOne: jest.fn((entity: EntityTarget<unknown>) =>
        Promise.resolve(answers.get(entity) ?? null),
      ),
      save: jest.fn((_entity, row) => Promise.resolve(row)),
      create: jest.fn((entity: EntityTarget<unknown>, input) =>
        entity === CharacterFleetMembershipEntity
          ? Object.assign(new CharacterFleetMembershipEntity(), input)
          : input,
      ),
      softRemove: jest.fn(() => Promise.resolve(undefined)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterFleetMembershipService,
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

    service = module.get(CharacterFleetMembershipService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('proving who is asking', () => {
    it('refuses a Character belonging to somebody else', async () => {
      answers.set(
        AccountEntity,
        Object.assign(new AccountEntity(), {
          id: 'account-1',
          userId: 'someone-else',
        }),
      );

      await expect(service.listForOwner(characterId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    /**
     * An account that has gone leaves a Character nobody owns. The check
     * compares against a value that is then undefined, which is not the
     * caller's id, so the refusal is the same one — deliberately, because
     * "your account is missing" is not something to explain at this door.
     */
    it('refuses a Character whose account cannot be read', async () => {
      answers.set(AccountEntity, null);

      await expect(service.listForOwner(characterId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('reports a Character that is not there', async () => {
      answers.set(CharacterEntity, null);

      await expect(service.listForOwner(characterId, ownerId)).rejects.toThrow(
        NotFoundException,
      );
    });

    /**
     * Reading does not lock. The lock exists to serialise writes against one
     * Character, and taking it to answer a GET would queue readers behind
     * whoever is currently recording something.
     */
    it('does not lock the Character to read the history', async () => {
      await service.listForOwner(characterId, ownerId);

      expect(manager.findOne).toHaveBeenCalledWith(
        CharacterEntity,
        expect.not.objectContaining({ lock: expect.anything() }),
      );
    });

    it('locks the Character to write', async () => {
      await service.record(characterId, ownerId, {
        fleetId,
        validFrom: new Date('2026-02-01T00:00:00.000Z'),
      });

      expect(manager.findOne).toHaveBeenCalledWith(CharacterEntity, {
        where: { id: characterId },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('exposes the check for the proposal service to reuse', async () => {
      await expect(
        service.requireOwnedCharacter(manager as never, characterId, ownerId),
      ).resolves.toMatchObject({ id: characterId });
    });
  });

  describe('reading the history', () => {
    it('returns every membership, latest start first', async () => {
      const rows = [membership({ id: 'later' }), membership({ id: 'earlier' })];

      manager.find.mockResolvedValueOnce(rows);

      await expect(service.listForOwner(characterId, ownerId)).resolves.toBe(
        rows,
      );
      expect(manager.find).toHaveBeenCalledWith(
        CharacterFleetMembershipEntity,
        expect.objectContaining({
          order: { validFrom: 'DESC', createdAt: 'DESC' },
        }),
      );
    });
  });

  describe('recording a membership', () => {
    it('writes what the owner said, private unless they widened it', async () => {
      const validFrom = new Date('2026-02-01T00:00:00.000Z');

      const written = await service.record(characterId, ownerId, {
        fleetId,
        validFrom,
      });

      expect(written).toMatchObject({
        characterId,
        fleetId,
        validFrom,
        validTo: null,
        source: CharacterFleetMembershipSource.MANUAL,
        proposalId: null,
        visibility: FleetAudience.PRIVATE,
        actorUserId: ownerId,
      });
    });

    it('honours an audience the owner chose', async () => {
      const written = await service.record(characterId, ownerId, {
        fleetId,
        validFrom: new Date('2026-02-01T00:00:00.000Z'),
        visibility: FleetAudience.FLEET_MEMBERS,
      });

      expect(written.visibility).toBe(FleetAudience.FLEET_MEMBERS);
    });

    /**
     * FC-014's first acceptance criterion. The close and the open are one
     * transaction: a failure between them would record a departure nobody
     * made and leave the Character in no Fleet at all.
     */
    it('closes the open membership at the moment the new one begins', async () => {
      const open = membership({ id: 'open' });

      existing = [open];

      const validFrom = new Date('2026-06-01T00:00:00.000Z');

      await service.record(characterId, ownerId, {
        fleetId: 'fleet-2',
        validFrom,
      });

      expect(manager.save).toHaveBeenNthCalledWith(
        1,
        CharacterFleetMembershipEntity,
        expect.objectContaining({ id: 'open', validTo: validFrom }),
      );
      expect(manager.save).toHaveBeenNthCalledWith(
        2,
        CharacterFleetMembershipEntity,
        expect.objectContaining({ fleetId: 'fleet-2', validTo: null }),
      );
    });

    it('refuses a current membership starting before the one already open', async () => {
      existing = [
        membership({ validFrom: new Date('2026-06-01T00:00:00.000Z') }),
      ];

      await expect(
        service.record(characterId, ownerId, {
          fleetId: 'fleet-2',
          validFrom: new Date('2026-03-01T00:00:00.000Z'),
        }),
      ).rejects.toThrow(/already recorded as being in a Fleet from that date/);
    });

    it('refuses an interval that ends before it begins', async () => {
      await expect(
        service.record(characterId, ownerId, {
          fleetId,
          validFrom: new Date('2026-06-01T00:00:00.000Z'),
          validTo: new Date('2026-03-01T00:00:00.000Z'),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a Fleet that is not there', async () => {
      answers.set(StoFleetEntity, null);

      await expect(
        service.record(characterId, ownerId, {
          fleetId,
          validFrom: new Date('2026-02-01T00:00:00.000Z'),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * A Character is in one Fleet at a time, so two intervals sharing an
     * instant are a contradiction rather than a detail. The owner is told,
     * rather than one of the two being trimmed to fit on their behalf.
     */
    it('refuses a past membership that overlaps one already recorded', async () => {
      existing = [
        membership({
          id: 'past',
          validFrom: new Date('2025-01-01T00:00:00.000Z'),
          validTo: new Date('2025-12-31T00:00:00.000Z'),
        }),
      ];

      await expect(
        service.record(characterId, ownerId, {
          fleetId: 'fleet-2',
          validFrom: new Date('2025-06-01T00:00:00.000Z'),
          validTo: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ).rejects.toThrow(/over part of that period/);
    });

    it('refuses a past membership that reaches into the open one', async () => {
      existing = [
        membership({ validFrom: new Date('2026-01-01T00:00:00.000Z') }),
      ];

      await expect(
        service.record(characterId, ownerId, {
          fleetId: 'fleet-2',
          validFrom: new Date('2025-06-01T00:00:00.000Z'),
          validTo: new Date('2026-06-01T00:00:00.000Z'),
        }),
      ).rejects.toThrow(/over part of that period/);
    });

    it('accepts a past membership that ends before the open one begins', async () => {
      existing = [
        membership({ validFrom: new Date('2026-01-01T00:00:00.000Z') }),
      ];

      const written = await service.record(characterId, ownerId, {
        fleetId: 'fleet-2',
        validFrom: new Date('2025-06-01T00:00:00.000Z'),
        validTo: new Date('2025-12-01T00:00:00.000Z'),
      });

      expect(written.validTo).toEqual(new Date('2025-12-01T00:00:00.000Z'));
      expect(manager.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('leaving a Fleet', () => {
    it('closes the open membership and keeps it', async () => {
      const open = membership();

      answers.set(CharacterFleetMembershipEntity, open);

      const validTo = new Date('2026-06-01T00:00:00.000Z');
      const left = await service.leave(characterId, ownerId, validTo);

      expect(left.validTo).toBe(validTo);
      expect(manager.softRemove).not.toHaveBeenCalled();
    });

    /**
     * The audience it was given stands. A membership published to a Fleet's
     * members remains visible to them as something that was true, rather than
     * vanishing on the day it stopped being current.
     */
    it('leaves the audience alone', async () => {
      answers.set(
        CharacterFleetMembershipEntity,
        membership({ visibility: FleetAudience.FLEET_MEMBERS }),
      );

      const left = await service.leave(
        characterId,
        ownerId,
        new Date('2026-06-01T00:00:00.000Z'),
      );

      expect(left.visibility).toBe(FleetAudience.FLEET_MEMBERS);
    });

    it('reports a Character that is in no Fleet', async () => {
      await expect(
        service.leave(characterId, ownerId, new Date()),
      ).rejects.toThrow(/not recorded as being in a Fleet/);
    });

    it('refuses a departure before the join', async () => {
      answers.set(
        CharacterFleetMembershipEntity,
        membership({ validFrom: new Date('2026-06-01T00:00:00.000Z') }),
      );

      await expect(
        service.leave(
          characterId,
          ownerId,
          new Date('2026-01-01T00:00:00.000Z'),
        ),
      ).rejects.toThrow(/cannot be left before it was joined/);
    });
  });

  describe('withdrawing a membership recorded in error', () => {
    it('takes the row out of the history', async () => {
      const row = membership();

      answers.set(CharacterFleetMembershipEntity, row);

      await service.retract(characterId, 'membership-1', ownerId);

      expect(manager.softRemove).toHaveBeenCalledWith(
        CharacterFleetMembershipEntity,
        row,
      );
    });

    /**
     * Matched on the Character as well as the identifier. A membership
     * belonging to somebody else's Character is not found rather than
     * forbidden: confirming it exists would say something about it.
     */
    it('reports a membership that is not this Character’s', async () => {
      await expect(
        service.retract(characterId, 'somebody-elses', ownerId),
      ).rejects.toThrow(NotFoundException);
      expect(manager.findOne).toHaveBeenCalledWith(
        CharacterFleetMembershipEntity,
        expect.objectContaining({
          where: { id: 'somebody-elses', characterId },
        }),
      );
    });
  });

  describe('changing who may see one', () => {
    it('saves the audience the owner chose', async () => {
      answers.set(CharacterFleetMembershipEntity, membership());

      const changed = await service.setVisibility(
        characterId,
        'membership-1',
        ownerId,
        FleetAudience.PUBLIC,
      );

      expect(changed.visibility).toBe(FleetAudience.PUBLIC);
      expect(manager.save).toHaveBeenCalledWith(
        CharacterFleetMembershipEntity,
        expect.objectContaining({ visibility: FleetAudience.PUBLIC }),
      );
    });

    it('reports a membership that is not there', async () => {
      await expect(
        service.setVisibility(
          characterId,
          'missing',
          ownerId,
          FleetAudience.PUBLIC,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
