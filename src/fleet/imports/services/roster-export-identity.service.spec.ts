import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FleetNameAliasEntity } from '../../entities/fleet-name-alias.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { RosterFilenameRejectionCode } from '../enums/roster-filename-rejection-code.enum';
import { RosterExportIdentityService } from './roster-export-identity.service';

const LONDON = 'Europe/London';
const NEW_YORK = 'America/New_York';

const FLEET_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

describe('RosterExportIdentityService', () => {
  let service: RosterExportIdentityService;
  let aliases: FleetNameAliasEntity[];
  let find: jest.Mock;

  /**
   * A Fleet registered under one exact name.
   *
   * @param exactGameName - The name as it appears in game.
   * @returns Enough of a Fleet for the identity check.
   */
  function fleet(exactGameName: string): StoFleetEntity {
    return { id: FLEET_ID, exactGameName } as StoFleetEntity;
  }

  /**
   * A recorded former name.
   *
   * @param exactName - The name.
   * @param validFrom - When the Fleet began using it.
   * @param validTo - When it stopped, or null while still current.
   * @returns The alias row.
   */
  function alias(
    exactName: string,
    validFrom: string,
    validTo: string | null = null,
  ): FleetNameAliasEntity {
    return {
      fleetId: FLEET_ID,
      exactName,
      validFrom: new Date(validFrom),
      validTo: validTo === null ? null : new Date(validTo),
    } as FleetNameAliasEntity;
  }

  beforeEach(async () => {
    aliases = [];
    find = jest.fn(() => Promise.resolve(aliases));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RosterExportIdentityService,
        {
          provide: getRepositoryToken(FleetNameAliasEntity),
          useValue: { find },
        },
      ],
    }).compile();

    service = module.get(RosterExportIdentityService);
  });

  describe('a name that says what it should', () => {
    it('reports the Fleet, the stamp and the instant it names', async () => {
      const identity = await service.identify({
        fleet: fleet('MidNite Taskforce'),
        filename: 'MidNite Taskforce_20260824-061342.Csv',
        timezone: LONDON,
      });

      expect(identity).toEqual({
        rejection: null,
        fleetLabel: 'MidNite Taskforce',
        localStamp: '2026-08-24T06:13:42',
        exportedAt: new Date('2026-08-24T05:13:42.000Z'),
        candidates: [new Date('2026-08-24T05:13:42.000Z')],
        matchedAlias: null,
      });
    });

    // The controlled pair from the implementation plan: the same roster
    // exported four seconds apart from two continents. Only reading each
    // stamp through its own zone makes them four seconds apart here too.
    it('reads the controlled pair to instants four seconds apart', async () => {
      const eastern = await service.identify({
        fleet: fleet('MidNite Taskforce'),
        filename: 'MidNite Taskforce_20260824-011338.Csv',
        timezone: NEW_YORK,
      });
      const british = await service.identify({
        fleet: fleet('MidNite Taskforce'),
        filename: 'MidNite Taskforce_20260824-061342.Csv',
        timezone: LONDON,
      });

      expect(eastern.exportedAt).toEqual(new Date('2026-08-24T05:13:38.000Z'));
      expect(british.exportedAt).toEqual(new Date('2026-08-24T05:13:42.000Z'));
    });

    it('asks for no alias when the current name matched', async () => {
      await service.identify({
        fleet: fleet('MidNite Taskforce'),
        filename: 'MidNite Taskforce_20260824-061342.Csv',
        timezone: LONDON,
      });

      expect(find).not.toHaveBeenCalled();
    });

    // A name typed with a combining accent and the same name typed with a
    // precomposed one are the same name.
    it('matches a name composed differently in the two places', async () => {
      const identity = await service.identify({
        fleet: fleet('Café Fleet'),
        filename: 'Café Fleet_20240101-120000.Csv',
        timezone: LONDON,
      });

      expect(identity.rejection).toBeNull();
    });
  });

  describe('a name that does not', () => {
    it('refuses a name the game did not write', async () => {
      const identity = await service.identify({
        fleet: fleet('Fixture Suffixed Fleet'),
        filename: 'Fixture Suffixed Fleet_20240109-120000 - Steve Export.Csv',
        timezone: LONDON,
      });

      expect(identity).toMatchObject({
        rejection: RosterFilenameRejectionCode.SHAPE_UNRECOGNISED,
        fleetLabel: null,
        localStamp: null,
        candidates: [],
      });
    });

    it('refuses a stamp whose digits name no real time', async () => {
      const identity = await service.identify({
        fleet: fleet('Fleet'),
        filename: 'Fleet_20241332-250000.Csv',
        timezone: LONDON,
      });

      expect(identity).toMatchObject({
        rejection: RosterFilenameRejectionCode.STAMP_NOT_A_TIME,
        fleetLabel: 'Fleet',
        localStamp: null,
      });
    });

    // Nothing was exported in an hour that did not happen, so either the
    // timezone is wrong or the name is.
    it('refuses a stamp inside a spring-forward gap', async () => {
      const identity = await service.identify({
        fleet: fleet('Fleet'),
        filename: 'Fleet_20240310-023000.Csv',
        timezone: NEW_YORK,
      });

      expect(identity).toMatchObject({
        rejection: RosterFilenameRejectionCode.STAMP_NONEXISTENT,
        localStamp: '2024-03-10T02:30:00',
        exportedAt: null,
      });
    });

    it('refuses a name belonging to a different Fleet', async () => {
      const identity = await service.identify({
        fleet: fleet('MidNite Taskforce'),
        filename: 'Some Other Fleet_20240101-120000.Csv',
        timezone: LONDON,
      });

      expect(identity).toMatchObject({
        rejection: RosterFilenameRejectionCode.FLEET_NAME_MISMATCH,
        fleetLabel: 'Some Other Fleet',
        exportedAt: new Date('2024-01-01T12:00:00.000Z'),
      });
    });

    // Not case-folded, not trimmed, never against the slug. A leading space is
    // how two Fleets in this game are deliberately told apart.
    it.each([
      ['a difference of case', 'midnite taskforce'],
      ['a leading space', ' MidNite Taskforce'],
      ['a trailing space', 'MidNite Taskforce '],
      ['the slug', 'midnite-taskforce'],
      ['stripped punctuation', 'MidNite Taskforce!'],
    ])('refuses %s', async (_case, label) => {
      const identity = await service.identify({
        fleet: fleet('MidNite Taskforce'),
        filename: `${label}_20240101-120000.Csv`,
        timezone: LONDON,
      });

      expect(identity.rejection).toBe(
        RosterFilenameRejectionCode.FLEET_NAME_MISMATCH,
      );
    });

    it('refuses a timezone the runtime does not know', async () => {
      await expect(
        service.identify({
          fleet: fleet('Fleet'),
          filename: 'Fleet_20240101-120000.Csv',
          timezone: 'Middle/Earth',
        }),
      ).rejects.toThrow('Unknown timezone: Middle/Earth');
    });
  });

  describe('a Fleet that has been renamed', () => {
    it('accepts an export named for a former name it was using', async () => {
      aliases = [
        alias('The SCC', '2021-01-01T00:00:00Z', '2022-06-01T00:00:00Z'),
      ];

      const identity = await service.identify({
        fleet: fleet('The SCC Fleet'),
        filename: 'The SCC_20211221-034426.Csv',
        timezone: LONDON,
      });

      expect(identity).toMatchObject({
        rejection: null,
        matchedAlias: 'The SCC',
      });
    });

    it('accepts an alias with no end recorded', async () => {
      aliases = [alias('The SCC', '2021-01-01T00:00:00Z')];

      const identity = await service.identify({
        fleet: fleet('The SCC Fleet'),
        filename: 'The SCC_20240101-120000.Csv',
        timezone: LONDON,
      });

      expect(identity.rejection).toBeNull();
    });

    it('refuses an export from before the Fleet used that name', async () => {
      aliases = [
        alias('The SCC', '2021-01-01T00:00:00Z', '2022-06-01T00:00:00Z'),
      ];

      const identity = await service.identify({
        fleet: fleet('The SCC Fleet'),
        filename: 'The SCC_20200101-120000.Csv',
        timezone: LONDON,
      });

      expect(identity.rejection).toBe(
        RosterFilenameRejectionCode.FLEET_NAME_MISMATCH,
      );
    });

    it('refuses an export from after the Fleet stopped using it', async () => {
      aliases = [
        alias('The SCC', '2021-01-01T00:00:00Z', '2022-06-01T00:00:00Z'),
      ];

      const identity = await service.identify({
        fleet: fleet('The SCC Fleet'),
        filename: 'The SCC_20230101-120000.Csv',
        timezone: LONDON,
      });

      expect(identity.rejection).toBe(
        RosterFilenameRejectionCode.FLEET_NAME_MISMATCH,
      );
    });

    it('refuses a name no alias records at all', async () => {
      aliases = [alias('The SCC', '2021-01-01T00:00:00Z')];

      const identity = await service.identify({
        fleet: fleet('The SCC Fleet'),
        filename: 'The SCC YDPSS_20211221-034426.Csv',
        timezone: LONDON,
      });

      expect(identity.rejection).toBe(
        RosterFilenameRejectionCode.FLEET_NAME_MISMATCH,
      );
    });

    it('asks only for this Fleet in aliases', async () => {
      await service.identify({
        fleet: fleet('The SCC Fleet'),
        filename: 'The SCC_20240101-120000.Csv',
        timezone: LONDON,
      });

      expect(find).toHaveBeenCalledWith({ where: { fleetId: FLEET_ID } });
    });
  });

  describe('a stamp the clock went back over', () => {
    // Half past one happens twice on 25 October 2026. Which one an export was
    // taken at decides which of two snapshots is the later, so nothing here
    // picks one.
    it('hands back both instants and settles on neither', async () => {
      const identity = await service.identify({
        fleet: fleet('Fleet'),
        filename: 'Fleet_20261025-013000.Csv',
        timezone: LONDON,
      });

      expect(identity).toMatchObject({
        rejection: null,
        exportedAt: null,
        candidates: [
          new Date('2026-10-25T00:30:00.000Z'),
          new Date('2026-10-25T01:30:00.000Z'),
        ],
      });
    });

    // The alias has to cover both readings, so the answer does not depend on a
    // choice nobody has made yet.
    it('accepts an alias covering both readings', async () => {
      aliases = [alias('Old Fleet', '2020-01-01T00:00:00Z')];

      const identity = await service.identify({
        fleet: fleet('Fleet'),
        filename: 'Old Fleet_20261025-013000.Csv',
        timezone: LONDON,
      });

      expect(identity.matchedAlias).toBe('Old Fleet');
    });

    it('refuses an alias that ends between the two readings', async () => {
      aliases = [
        alias('Old Fleet', '2020-01-01T00:00:00Z', '2026-10-25T01:00:00Z'),
      ];

      const identity = await service.identify({
        fleet: fleet('Fleet'),
        filename: 'Old Fleet_20261025-013000.Csv',
        timezone: LONDON,
      });

      expect(identity.rejection).toBe(
        RosterFilenameRejectionCode.FLEET_NAME_MISMATCH,
      );
    });
  });
});
