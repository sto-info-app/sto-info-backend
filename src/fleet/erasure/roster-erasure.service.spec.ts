import { ConflictException, Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';
import { LEDGER_CHUNK_SIZE, LedgerKey } from 'src/shared/ledger/ledger.utility';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { InMemoryManager, Row } from '../../../test/in-memory-manager';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { RosterIdentityAliasEntity } from '../identity/entities/roster-identity-alias.entity';
import { RosterImportSourceEntity } from '../imports/entities/roster-import-source.entity';
import { RosterObservationEntity } from '../imports/entities/roster-observation.entity';
import { RosterSourceRetentionService } from '../imports/services/roster-source-retention.service';
import { RosterTypedParserService } from '../imports/services/roster-typed-parser.service';
import { RosterReplayQueueService } from '../projection/services/roster-replay-queue.service';
import { ErasureLedgerService, ErasureMarker } from './erasure-ledger.service';
import { ERASED_MEMBER_NAME, pseudonymFor } from './roster-erasure.constants';
import { RosterErasureEntity } from './roster-erasure.entity';
import {
  REPLAYED_REASON,
  RosterErasureService,
} from './roster-erasure.service';
import { RosterSuppressionService } from './roster-suppression.service';

const KEY = 'test-erasure-key';
const ADMIN_ID = 'admin-1';

/**
 * A roster row.
 *
 * @param id - Its ID.
 * @param fleetId - Its Fleet.
 * @param importSourceId - Its import.
 * @param name - The normalised name.
 * @param handle - The normalised handle.
 * @returns The row.
 */
const observation = (
  id: string,
  fleetId: string,
  importSourceId: string,
  name: string,
  handle: string,
): Row => ({
  id,
  fleetId,
  importSourceId,
  characterName: name,
  characterNameNormalised: name,
  accountHandle: handle,
  accountHandleNormalised: handle,
  publicComment: 'Ask me about warp cores',
});

describe('RosterErasureService (FC-038)', () => {
  let db: InMemoryManager;
  let suppression: RosterSuppressionService;
  let ledger: {
    write: jest.Mock<(marker: ErasureMarker) => Promise<void>>;
    listKeys: jest.Mock<() => Promise<LedgerKey[]>>;
    read: jest.Mock<(key: string) => Promise<ErasureMarker>>;
  };
  let sources: {
    erase: jest.Mock<(ids: readonly string[]) => Promise<unknown>>;
  };
  let replays: {
    request: jest.Mock<(...args: unknown[]) => Promise<void>>;
    enqueue: jest.Mock<(fleetId: string) => Promise<void>>;
  };
  let parser: { read: jest.Mock<(bytes: Buffer, zone: string) => unknown> };
  let service: RosterErasureService;

  beforeEach(() => {
    db = new InMemoryManager()
      .seed(FleetCommunityEntity, [{ id: 'c1', name: 'Fixture Community' }])
      .seed(StoFleetEntity, [
        { id: 'fleet-1', exactGameName: 'Ninth Fleet', communityId: 'c1' },
        { id: 'fleet-2', exactGameName: 'Tenth Fleet', communityId: null },
      ])
      .seed(RosterObservationEntity, [
        observation('o1', 'fleet-1', 'import-1', 'kira', '@nerys'),
        observation('o2', 'fleet-2', 'import-2', 'kira', '@nerys'),
        observation('o3', 'fleet-1', 'import-1', 'odo', '@constable'),
      ])
      .seed(RosterIdentityAliasEntity, [
        {
          id: 'alias-1',
          fleetId: 'fleet-1',
          characterName: 'Kira',
          characterNameNormalised: 'kira',
          accountHandle: '@Nerys',
          accountHandleNormalised: '@nerys',
        },
      ])
      .seed(FileAssetPlacementEntity, [
        placement('import-3', 'asset-3', FileAssetPlacementState.HELD),
        placement('import-4', 'asset-4', FileAssetPlacementState.PENDING),
        placement('import-5', 'asset-5', FileAssetPlacementState.HELD),
        placement('import-6', 'asset-6', FileAssetPlacementState.HELD),
      ])
      .seed(FileAssetEntity, [
        asset('asset-3', 'names-kira'),
        asset('asset-4', null),
        { ...asset('asset-5', 'gone'), state: FileAssetState.DELETED },
        asset('asset-6', 'names-odo'),
      ])
      .seed(RosterImportSourceEntity, [
        { id: 'import-3', exportTimezone: 'Europe/London' },
        { id: 'import-6', exportTimezone: null },
      ])
      .seed(UserProfileEntity, [{ userId: ADMIN_ID, username: 'Quark' }]);
    // The one query the in-memory manager has no builder for: the distinct
    // pairs a ledger replay hashes.
    db.createQueryBuilder = ((entity: never) => {
      const builder = {
        select: () => builder,
        addSelect: () => builder,
        distinct: () => builder,
        getRawMany: () => Promise.resolve(db.rows(entity)),
      };

      return builder;
    }) as never;
    suppression = new RosterSuppressionService(db.asDataSource(), {
      value: KEY,
    });
    ledger = {
      write: jest.fn(async () => undefined),
      listKeys: jest.fn(async () => []),
      read: jest.fn(),
    };
    sources = {
      erase: jest.fn(async ids => ({
        deleted: ids.length,
        retired: 0,
        notDeleted: 1,
        fleetIds: [],
      })),
    };
    replays = {
      request: jest.fn(async () => undefined),
      enqueue: jest.fn(async () => undefined),
    };
    parser = {
      read: jest.fn((bytes: Buffer) => ({
        rows:
          String(bytes) === 'names-kira'
            ? [{ characterName: 'KIRA', accountHandle: ' @Nerys ' }]
            : [{ characterName: 'Odo', accountHandle: '@constable' }],
        problems: [],
      })),
    };
    service = new RosterErasureService(
      db.asDataSource(),
      suppression,
      ledger as unknown as ErasureLedgerService,
      sources as unknown as RosterSourceRetentionService,
      replays as unknown as RosterReplayQueueService,
      {
        read: jest.fn(async (key: string) => Buffer.from(key)),
      } as unknown as QuarantineStorageService,
      parser as unknown as RosterTypedParserService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * A roster import's placement.
   *
   * @param subjectId - The import.
   * @param assetId - Its file.
   * @param state - Its state.
   * @returns The placement.
   */
  function placement(
    subjectId: string,
    assetId: string,
    state: FileAssetPlacementState,
  ): Row {
    return {
      id: `placement-${subjectId}`,
      subject: FileAssetSubject.ROSTER_IMPORT,
      subjectId,
      assetId,
      state,
    };
  }

  /**
   * A stored file.
   *
   * @param id - Its ID.
   * @param objectKey - Its key, or null.
   * @returns The file.
   */
  function asset(id: string, objectKey: string | null): Row {
    return {
      id,
      state: FileAssetState.AVAILABLE,
      objectKey,
      objectVersion: null,
    };
  }

  const kira = { characterName: 'Kira', accountHandle: '@Nerys' };

  describe('preview', () => {
    it('lists the Fleets whose rosters name them, changing nothing', async () => {
      await expect(service.preview(kira)).resolves.toEqual({
        alreadyErased: false,
        rows: 2,
        fleets: [
          {
            fleetId: 'fleet-1',
            fleetName: 'Ninth Fleet',
            communityName: 'Fixture Community',
            rows: 1,
          },
          {
            fleetId: 'fleet-2',
            fleetName: 'Tenth Fleet',
            communityName: null,
            rows: 1,
          },
        ],
      });
      expect(db.rows(RosterObservationEntity)[0].characterName).toBe('kira');
    });

    it('finds nothing for somebody no roster names', async () => {
      await expect(
        service.preview({ characterName: 'Garak', accountHandle: '@tailor' }),
      ).resolves.toEqual({ alreadyErased: false, rows: 0, fleets: [] });
    });

    it('names no Community for a Fleet whose Community has gone', async () => {
      db.rows(FleetCommunityEntity).splice(0);

      await expect(service.preview(kira)).resolves.toEqual(
        expect.objectContaining({
          fleets: [
            expect.objectContaining({
              fleetId: 'fleet-1',
              communityName: null,
            }),
            expect.objectContaining({
              fleetId: 'fleet-2',
              communityName: null,
            }),
          ],
        }),
      );
    });

    it('asks after no Community when no Fleet naming them has one', async () => {
      db.rows(RosterObservationEntity).splice(0, 1);

      await expect(service.preview(kira)).resolves.toEqual(
        expect.objectContaining({
          fleets: [expect.objectContaining({ fleetId: 'fleet-2' })],
        }),
      );
    });
  });

  describe('erase', () => {
    it('writes the marker first, anonymises every row and alias, and deletes each file naming them', async () => {
      const done = await service.erase(ADMIN_ID, {
        ...kira,
        reason: 'Verified in game by Quark',
      });
      const marker = ledger.write.mock.calls[0][0];
      const erased = {
        characterName: ERASED_MEMBER_NAME,
        accountHandle: marker.pseudonym,
      };

      expect(marker).toEqual({
        id: done.id,
        pairHash: suppression.hashOf('Kira', '@Nerys'),
        pseudonym: pseudonymFor(done.id),
        createdAt: expect.any(String),
      });
      expect(ledger.write.mock.invocationCallOrder[0]).toBeLessThan(
        replays.request.mock.invocationCallOrder[0],
      );
      expect(db.rows(RosterObservationEntity)).toEqual([
        expect.objectContaining({ id: 'o1', ...erased, publicComment: '' }),
        expect.objectContaining({ id: 'o2', ...erased, publicComment: '' }),
        expect.objectContaining({ id: 'o3', characterName: 'odo' }),
      ]);
      expect(db.rows(RosterIdentityAliasEntity)[0]).toEqual(
        expect.objectContaining(erased),
      );
      expect(sources.erase).toHaveBeenCalledWith([
        'import-1',
        'import-2',
        'import-3',
      ]);
      expect(replays.request).toHaveBeenCalledTimes(2);
      expect(replays.enqueue.mock.calls.map(([fleetId]) => fleetId)).toEqual([
        'fleet-1',
        'fleet-2',
      ]);
      expect(done).toEqual(
        expect.objectContaining({
          pseudonym: marker.pseudonym,
          reason: 'Verified in game by Quark',
          admin: { userId: ADMIN_ID, username: 'Quark' },
          replayed: false,
          observations: 2,
          aliases: 1,
          fleets: 2,
          filesDeleted: 3,
          filesPending: 1,
        }),
      );
      expect(db.rows(RosterErasureEntity)[0]).not.toHaveProperty(
        'characterName',
      );
    });

    it('refuses somebody already erased', async () => {
      await service.erase(ADMIN_ID, { ...kira, reason: 'Verified in game' });

      await expect(
        service.erase(ADMIN_ID, {
          characterName: 'KIRA',
          accountHandle: '@nerys',
          reason: 'Verified in game again',
        }),
      ).rejects.toThrow(ConflictException);
      await expect(service.preview(kira)).resolves.toEqual(
        expect.objectContaining({ alreadyErased: true, rows: 0 }),
      );
    });

    it('still keeps somebody out of future imports when no roster names them', async () => {
      const done = await service.erase(ADMIN_ID, {
        characterName: 'Garak',
        accountHandle: '@tailor',
        reason: 'Verified by email',
      });

      expect(done).toEqual(
        expect.objectContaining({ observations: 0, aliases: 0, fleets: 0 }),
      );
      expect(sources.erase).toHaveBeenCalledWith([]);
      expect(replays.enqueue).not.toHaveBeenCalled();
    });

    it('reads no file when nothing is held or pending', async () => {
      db.rows(FileAssetPlacementEntity).splice(0);

      await service.erase(ADMIN_ID, { ...kira, reason: 'Verified in game' });

      expect(parser.read).not.toHaveBeenCalled();
      expect(sources.erase).toHaveBeenCalledWith(['import-1', 'import-2']);
    });
  });

  it('lists erasures newest first, without who was erased', async () => {
    db.seed(RosterErasureEntity, [
      {
        id: 'old',
        pseudonym: '@erased-old',
        reason: 'Old request',
        adminUserId: null,
        replayed: true,
        counts: {},
        createdAt: new Date(1),
      },
      {
        id: 'new',
        pseudonym: '@erased-new',
        reason: 'New request',
        adminUserId: 'gone',
        replayed: false,
        counts: { observations: 3, aliases: 1, fleets: 1 },
        createdAt: new Date(2),
      },
    ]);

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'new',
        admin: { userId: 'gone', username: null },
        observations: 3,
      }),
      expect.objectContaining({
        id: 'old',
        admin: null,
        replayed: true,
        observations: 0,
        aliases: 0,
        fleets: 0,
      }),
    ]);
  });

  describe('checking the ledger at boot (FC-042)', () => {
    /**
     * A key the ledger lists for a marker.
     *
     * @param marker - The marker.
     * @returns Its key.
     */
    const keyOf = (marker: ErasureMarker): LedgerKey => ({
      key: `test/erasure-ledger/${marker.createdAt}_${marker.id}.json`,
      createdAt: marker.createdAt,
      id: marker.id,
      kind: null,
    });

    /**
     * Lists markers, and reads each back by its key.
     *
     * @param markers - What the ledger holds.
     */
    const holding = (...markers: ErasureMarker[]): void => {
      ledger.listKeys.mockResolvedValue(markers.map(keyOf));
      ledger.read.mockImplementation(async key => {
        const found = markers.find(marker => keyOf(marker).key === key);

        return found as ErasureMarker;
      });
    };

    it('makes again only what the database lost, oldest first, finding the pair by its hash', async () => {
      db.seed(RosterErasureEntity, [
        {
          id: 'known',
          pairHash: 'f'.repeat(64),
          pseudonym: '@erased-known',
          counts: {},
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ]);
      holding(
        {
          id: 'known',
          pairHash: 'f'.repeat(64),
          pseudonym: '@erased-known',
          createdAt: '2026-09-01T00:00:00.000Z',
        },
        {
          id: 'lost',
          pairHash: suppression.hashOf('Kira', '@Nerys'),
          pseudonym: '@erased-lost',
          createdAt: '2026-09-20T00:00:00.000Z',
        },
        {
          id: 'nothing-left',
          pairHash: 'e'.repeat(64),
          pseudonym: '@erased-nothing',
          createdAt: '2026-09-21T00:00:00.000Z',
        },
      );

      const outcome = await service.reconcileLedger();

      expect(outcome).toEqual({
        markers: 3,
        replayed: 2,
        backfilled: 0,
        detail: { alreadyErased: 0 },
        timings: {
          list: expect.any(Number),
          compare: expect.any(Number),
          replay: expect.any(Number),
          backfill: expect.any(Number),
        },
      });

      const lost = db
        .rows<Row>(RosterErasureEntity)
        .find(row => row.id === 'lost');

      expect(lost).toEqual(
        expect.objectContaining({
          reason: REPLAYED_REASON,
          adminUserId: null,
          replayed: true,
          createdAt: new Date('2026-09-20T00:00:00.000Z'),
          counts: { observations: 2, aliases: 1, fleets: 2 },
        }),
      );
      expect(db.rows(RosterObservationEntity)[0].accountHandle).toBe(
        '@erased-lost',
      );
      // Only the markers the database lacked were read.
      expect(ledger.read.mock.calls.map(([key]) => key)).toEqual([
        'test/erasure-ledger/2026-09-20T00:00:00.000Z_lost.json',
        'test/erasure-ledger/2026-09-21T00:00:00.000Z_nothing-left.json',
      ]);
      expect(ledger.write).not.toHaveBeenCalled();
    });

    it('leaves a marker whose pair is already erased under another erasure', async () => {
      const pairHash = suppression.hashOf('Kira', '@Nerys');

      db.seed(RosterErasureEntity, [
        {
          id: 'retried',
          pairHash,
          pseudonym: '@erased-retried',
          counts: {},
          createdAt: new Date('2026-09-02T00:00:00.000Z'),
        },
      ]);
      holding(
        {
          id: 'retried',
          pairHash,
          pseudonym: '@erased-retried',
          createdAt: '2026-09-02T00:00:00.000Z',
        },
        // One whose database write failed before the erasure was made again.
        {
          id: 'failed',
          pairHash,
          pseudonym: '@erased-failed',
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      );

      await expect(service.reconcileLedger()).resolves.toMatchObject({
        replayed: 0,
        detail: { alreadyErased: 1 },
      });
      expect(db.rows(RosterErasureEntity)).toHaveLength(1);
    });

    it('makes a pair two markers name only once', async () => {
      const pairHash = suppression.hashOf('Kira', '@Nerys');

      holding(
        {
          id: 'first',
          pairHash,
          pseudonym: '@erased-first',
          createdAt: '2026-09-01T00:00:00.000Z',
        },
        {
          id: 'second',
          pairHash,
          pseudonym: '@erased-second',
          createdAt: '2026-09-02T00:00:00.000Z',
        },
      );

      await expect(service.reconcileLedger()).resolves.toMatchObject({
        replayed: 1,
        detail: { alreadyErased: 1 },
      });
      expect(db.rows<Row>(RosterErasureEntity).map(row => row.id)).toEqual([
        'first',
      ]);
    });

    it('writes a marker for every erasure the ledger lacks, reading the database a chunk at a time', async () => {
      const erasures = Array.from(
        { length: LEDGER_CHUNK_SIZE + 1 },
        (_, n) => ({
          id: `erasure-${String(n).padStart(4, '0')}`,
          pairHash: String(n % 10).repeat(64),
          pseudonym: `@erased-${n}`,
          counts: {},
          createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, n)),
        }),
      );

      db.seed(RosterErasureEntity, erasures);
      holding({
        id: 'erasure-0000',
        pairHash: '0'.repeat(64),
        pseudonym: '@erased-0',
        createdAt: '2026-09-01T00:00:00.000Z',
      });

      const outcome = await service.reconcileLedger();

      expect(outcome).toMatchObject({
        markers: 1,
        replayed: 0,
        backfilled: LEDGER_CHUNK_SIZE,
      });
      expect(ledger.write).toHaveBeenCalledWith({
        id: 'erasure-0001',
        pairHash: '1'.repeat(64),
        pseudonym: '@erased-1',
        createdAt: '2026-09-01T00:00:01.000Z',
      });
      expect(ledger.read).not.toHaveBeenCalled();
    });
  });
});
