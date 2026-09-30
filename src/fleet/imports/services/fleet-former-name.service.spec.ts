import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { In, IsNull, Repository } from 'typeorm';

import { FleetNameAliasEntity } from '../../entities/fleet-name-alias.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { FleetFormerNameService } from './fleet-former-name.service';

const FLEET_ID = '8038747f-fcc3-41b4-b37e-83569c8800a3';
const ALIAS_ID = '0b6d8e1c-8f53-4a4e-9f5e-2f8f0c1d9a01';
const USER_ID = 'user-1';

const FROM = new Date('2025-01-01T00:00:00Z');
const TO = new Date('2026-01-01T00:00:00Z');

/**
 * Builds a recorded former name.
 *
 * @param overrides - Fields to override.
 * @returns The name.
 */
function aliasOf(
  overrides: Partial<FleetNameAliasEntity> = {},
): FleetNameAliasEntity {
  return {
    id: ALIAS_ID,
    fleetId: FLEET_ID,
    exactName: 'Old Name',
    exactNameNormalized: 'old name',
    validFrom: FROM,
    validTo: TO,
    reason: 'Renamed in game',
    recordedByUserId: USER_ID,
    recordedAt: new Date('2026-02-01T00:00:00Z'),
    deletedAt: null,
    removedByUserId: null,
    removalReason: null,
    recordedBy: { profile: { username: 'Writer' } },
    removedBy: null,
    ...overrides,
  } as unknown as FleetNameAliasEntity;
}

describe('FleetFormerNameService', () => {
  let aliases: {
    find: jest.Mock;
    findOneOrFail: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    query: jest.Mock;
  };
  let fleets: { findOneOrFail: jest.Mock };
  let imports: { find: jest.Mock };
  let service: FleetFormerNameService;
  let logged: jest.SpyInstance;

  beforeEach(() => {
    aliases = {
      find: jest.fn(() => Promise.resolve([])),
      findOneOrFail: jest.fn(() => Promise.resolve(aliasOf())),
      create: jest.fn((values: unknown) => values),
      save: jest.fn((values: object) =>
        Promise.resolve({ id: ALIAS_ID, ...values }),
      ),
      query: jest.fn(() => Promise.resolve([[], 1])),
    };
    fleets = {
      findOneOrFail: jest.fn(() =>
        Promise.resolve({ id: FLEET_ID, exactGameName: 'New Name' }),
      ),
    };
    imports = { find: jest.fn(() => Promise.resolve([])) };
    service = new FleetFormerNameService(
      aliases as unknown as Repository<FleetNameAliasEntity>,
      fleets as unknown as Repository<StoFleetEntity>,
      imports as unknown as Repository<RosterImportSourceEntity>,
    );
    logged = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logged.mockRestore();
  });

  describe('list', () => {
    it('reads every name of the Fleet, removed ones included', async () => {
      await service.list(FLEET_ID, true);

      expect(aliases.find).toHaveBeenCalledWith({
        where: { fleetId: FLEET_ID },
        withDeleted: true,
        relations: {
          recordedBy: { profile: true },
          removedBy: { profile: true },
        },
        order: { validTo: 'DESC', recordedAt: 'DESC' },
      });
    });

    it('separates names in use from removed ones, most recently removed first', async () => {
      aliases.find.mockResolvedValue([
        aliasOf({ id: 'in-use' }),
        aliasOf({
          id: 'removed-earlier',
          deletedAt: new Date('2026-03-01T00:00:00Z'),
          removalReason: 'Typo',
        }),
        aliasOf({
          id: 'removed-later',
          deletedAt: new Date('2026-04-01T00:00:00Z'),
          removedBy: { profile: { username: 'Fixer' } } as never,
          removalReason: 'Wrong Fleet',
        }),
      ]);

      const listed = await service.list(FLEET_ID, false);

      expect(listed.mayChange).toBe(false);
      expect(listed.items.map(name => name.id)).toEqual(['in-use']);
      expect(listed.removed.map(name => name.id)).toEqual([
        'removed-later',
        'removed-earlier',
      ]);
      expect(listed.removed[0]).toEqual(
        expect.objectContaining({
          removedByName: 'Fixer',
          removalReason: 'Wrong Fleet',
        }),
      );
    });

    it('counts the imports that matched each name, replaced ones aside', async () => {
      aliases.find.mockResolvedValue([
        aliasOf({ id: 'a' }),
        aliasOf({ id: 'b' }),
      ]);
      imports.find.mockResolvedValue([
        { id: 'i1', matchedAliasId: 'a' },
        { id: 'i2', matchedAliasId: 'a' },
      ]);

      const listed = await service.list(FLEET_ID, true);

      expect(imports.find).toHaveBeenCalledWith({
        select: { id: true, matchedAliasId: true },
        where: { matchedAliasId: In(['a', 'b']), replacedAt: IsNull() },
      });
      expect(listed.items.map(name => name.matchedImports)).toEqual([2, 0]);
    });

    it('asks about no imports when the Fleet has no names', async () => {
      await expect(service.list(FLEET_ID, true)).resolves.toEqual({
        items: [],
        removed: [],
        mayChange: true,
      });
      expect(imports.find).not.toHaveBeenCalled();
    });

    it('names nobody once an account has gone', async () => {
      aliases.find.mockResolvedValue([aliasOf({ recordedBy: null })]);

      const listed = await service.list(FLEET_ID, true);

      expect(listed.items[0].recordedByName).toBeNull();
    });
  });

  describe('record', () => {
    const dto = {
      exactName: ' Old Name',
      validFrom: FROM,
      validTo: TO,
      reason: 'Renamed in game',
    };

    it('records the name exactly as given, with who and why', async () => {
      await service.record(FLEET_ID, USER_ID, dto);

      expect(aliases.save).toHaveBeenCalledWith({
        fleetId: FLEET_ID,
        exactName: ' Old Name',
        exactNameNormalized: expect.any(String),
        validFrom: FROM,
        validTo: TO,
        reason: 'Renamed in game',
        recordedByUserId: USER_ID,
      });
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining(`AliasId: ${ALIAS_ID}`),
      );
    });

    it('answers with the name as recorded', async () => {
      await expect(service.record(FLEET_ID, USER_ID, dto)).resolves.toEqual(
        expect.objectContaining({ id: ALIAS_ID, recordedByName: 'Writer' }),
      );
      expect(aliases.findOneOrFail).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ALIAS_ID, fleetId: FLEET_ID },
          withDeleted: true,
        }),
      );
    });

    it.each([
      ['ends before it began', { validFrom: TO, validTo: FROM }],
      ['ends as it began', { validFrom: FROM, validTo: FROM }],
      [
        'has not ended yet',
        { validTo: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      ],
    ])('refuses an interval that %s', async (_label, interval) => {
      await expect(
        service.record(FLEET_ID, USER_ID, { ...dto, ...interval }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(aliases.save).not.toHaveBeenCalled();
    });

    it('refuses the Fleet’s name now', async () => {
      await expect(
        service.record(FLEET_ID, USER_ID, { ...dto, exactName: 'New Name' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([
      [
        'overlaps',
        { validFrom: new Date('2025-06-01T00:00:00Z'), validTo: TO },
      ],
      ['has no end', { validFrom: FROM, validTo: null }],
    ])(
      'refuses the same name where a recorded interval %s',
      async (_label, recorded) => {
        aliases.find.mockResolvedValue([
          aliasOf({ exactName: ' Old Name', ...recorded }),
        ]);

        await expect(
          service.record(FLEET_ID, USER_ID, dto),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it.each([
      ['another name', { exactName: 'Other Name' }],
      [
        'the same name at another time',
        {
          exactName: ' Old Name',
          validFrom: new Date('2023-01-01T00:00:00Z'),
          validTo: FROM,
        },
      ],
    ])('accepts it beside %s', async (_label, recorded) => {
      aliases.find.mockResolvedValue([aliasOf(recorded)]);

      await expect(
        service.record(FLEET_ID, USER_ID, dto),
      ).resolves.toBeDefined();
    });
  });

  describe('remove', () => {
    it('removes it in one statement, with who and why', async () => {
      await service.remove(FLEET_ID, ALIAS_ID, USER_ID, { reason: 'Typo' });

      expect(aliases.query).toHaveBeenCalledWith(
        expect.stringContaining('"deletedAt" IS NULL'),
        [ALIAS_ID, FLEET_ID, USER_ID, 'Typo'],
      );
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining(`AliasId: ${ALIAS_ID}`),
      );
    });

    it('answers with the name as it now stands', async () => {
      aliases.findOneOrFail.mockResolvedValue(
        aliasOf({ deletedAt: new Date(), removalReason: 'Typo' }),
      );

      await expect(
        service.remove(FLEET_ID, ALIAS_ID, USER_ID, { reason: 'Typo' }),
      ).resolves.toEqual(expect.objectContaining({ removalReason: 'Typo' }));
    });

    // Another Fleet's, already removed, or never there: the same answer.
    it('says there is no such name when nothing was removed', async () => {
      aliases.query.mockResolvedValue([[], 0]);

      await expect(
        service.remove(FLEET_ID, ALIAS_ID, USER_ID, { reason: 'Typo' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
