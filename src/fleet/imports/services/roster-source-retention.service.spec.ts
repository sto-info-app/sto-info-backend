import { Logger } from '@nestjs/common';

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
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetStorage } from 'src/file-assets/enums/file-asset-storage.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';

import { InMemoryManager, Row } from '../../../../test/in-memory-manager';
import { RosterReplayQueueService } from '../../projection/services/roster-replay-queue.service';
import { RETENTION_BATCH_SIZE } from '../../retention/retention.constants';
import { RosterImportActionEntity } from '../entities/roster-import-action.entity';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterImportActionKind } from '../enums/roster-import-action-kind.enum';
import {
  ROSTER_SOURCE_ERASED_REASON,
  RosterSourceRetentionService,
} from './roster-source-retention.service';

const DAY = 86_400_000;
const FLEET_ID = 'fleet-1';

describe('RosterSourceRetentionService (FC-037)', () => {
  let db: InMemoryManager;
  let quarantine: { remove: jest.Mock<(key: string) => Promise<void>> };
  let replays: {
    request: jest.Mock<(manager: unknown, fleetId: string) => Promise<void>>;
    enqueue: jest.Mock<(fleetId: string) => Promise<void>>;
  };
  let service: RosterSourceRetentionService;

  beforeEach(() => {
    db = new InMemoryManager();
    quarantine = { remove: jest.fn(async () => undefined) };
    replays = {
      request: jest.fn(async () => undefined),
      enqueue: jest.fn(async () => undefined),
    };
    service = new RosterSourceRetentionService(
      db.asDataSource(),
      quarantine as unknown as QuarantineStorageService,
      replays as unknown as RosterReplayQueueService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Seeds an import, its file and its placement.
   *
   * @param id - The import's number.
   * @param placement - Its placement's state, or null for none.
   * @param asset - What differs about its file.
   */
  const seed = (
    id: number,
    placement: FileAssetPlacementState | null,
    asset: Row = {},
  ): void => {
    db.seed(FileAssetEntity, [
      {
        id: `asset-${id}`,
        kind: FileAssetKind.ROSTER_IMPORT_SOURCE,
        state: FileAssetState.AVAILABLE,
        storage: FileAssetStorage.QUARANTINE,
        objectKey: `test/assets/asset-${id}`,
        retainUntil: new Date(Date.now() - DAY),
        ...asset,
      },
    ]);
    db.seed(RosterImportSourceEntity, [
      { id: `import-${id}`, fleetId: FLEET_ID, assetId: `asset-${id}` },
    ]);

    if (placement !== null) {
      db.seed(FileAssetPlacementEntity, [
        {
          id: `placement-${id}`,
          subject: FileAssetSubject.ROSTER_IMPORT,
          subjectId: `import-${id}`,
          assetId: `asset-${id}`,
          state: placement,
        },
      ]);
    }
  };

  const asset = (id: number): Row =>
    db.rows(FileAssetEntity).find(row => row.id === `asset-${id}`)!;

  const placement = (id: number): Row =>
    db
      .rows(FileAssetPlacementEntity)
      .find(row => row.id === `placement-${id}`)!;

  it('deletes a file in force and leaves the Fleet’s history as it was', async () => {
    seed(1, FileAssetPlacementState.ACTIVE);

    await expect(service.expire()).resolves.toEqual({
      counts: { expired: 1, retired: 0, notDeleted: 0 },
      complete: true,
    });
    expect(quarantine.remove).toHaveBeenCalledWith('test/assets/asset-1');
    expect(asset(1)).toEqual(
      expect.objectContaining({
        state: FileAssetState.DELETED,
        storage: FileAssetStorage.NONE,
        revocationReason: 'Expired: sanitised roster file past its retention',
        withdrawnAt: expect.any(Date),
      }),
    );
    expect(placement(1).state).toBe(FileAssetPlacementState.ACTIVE);
    expect(db.rows(RosterImportActionEntity)).toEqual([]);
    expect(replays.enqueue).not.toHaveBeenCalled();
  });

  it('retires a held import, logs why and replays its Fleet once', async () => {
    seed(1, FileAssetPlacementState.HELD);
    seed(2, FileAssetPlacementState.HELD);

    await expect(service.expire()).resolves.toEqual({
      counts: { expired: 2, retired: 2, notDeleted: 0 },
      complete: true,
    });
    expect(placement(1)).toEqual(
      expect.objectContaining({
        state: FileAssetPlacementState.WITHDRAWN,
        settledAt: expect.any(Date),
      }),
    );
    expect(db.rows(RosterImportActionEntity)).toEqual([
      expect.objectContaining({
        fleetId: FLEET_ID,
        importSourceId: 'import-1',
        action: RosterImportActionKind.SOURCE_EXPIRED,
        actorUserId: null,
        conflictGroupId: null,
      }),
      expect.objectContaining({ importSourceId: 'import-2' }),
    ]);
    expect(replays.request).toHaveBeenCalledTimes(2);
    expect(replays.enqueue).toHaveBeenCalledTimes(1);
    expect(replays.enqueue).toHaveBeenCalledWith(FLEET_ID);
  });

  it('leaves a file whose retention runs on, or that has already gone', async () => {
    seed(1, FileAssetPlacementState.ACTIVE, {
      retainUntil: new Date(Date.now() + DAY),
    });
    seed(2, FileAssetPlacementState.ACTIVE, { state: FileAssetState.DELETED });

    await expect(service.expire()).resolves.toEqual({
      counts: { expired: 0, retired: 0, notDeleted: 0 },
      complete: true,
    });
    expect(quarantine.remove).not.toHaveBeenCalled();
  });

  it('records a file with no bytes, or no import, as gone', async () => {
    seed(1, null, { objectKey: null });
    db.rows(RosterImportSourceEntity).splice(0);
    seed(2, null);
    seed(3, FileAssetPlacementState.REJECTED, {
      state: FileAssetState.REJECTED,
    });

    await expect(service.expire()).resolves.toEqual({
      counts: { expired: 3, retired: 0, notDeleted: 0 },
      complete: true,
    });
    expect(quarantine.remove).toHaveBeenCalledTimes(2);
    expect(asset(1).state).toBe(FileAssetState.DELETED);
  });

  it('leaves a file it could not delete for the next run', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    seed(1, FileAssetPlacementState.HELD);
    seed(2, FileAssetPlacementState.ACTIVE);
    quarantine.remove
      .mockRejectedValueOnce(new Error('R2 is down'))
      .mockRejectedValueOnce('down');

    await expect(service.expire()).resolves.toEqual({
      counts: { expired: 0, retired: 0, notDeleted: 2 },
      complete: false,
    });
    expect(asset(1).state).toBe(FileAssetState.AVAILABLE);
    expect(placement(1).state).toBe(FileAssetPlacementState.HELD);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Reason: unknown'),
    );

    await expect(service.expire()).resolves.toEqual({
      counts: { expired: 2, retired: 1, notDeleted: 0 },
      complete: true,
    });
  });

  it('takes a batch at a time, and says when more may be due', async () => {
    for (let index = 0; index < RETENTION_BATCH_SIZE; index++) {
      seed(index, FileAssetPlacementState.ACTIVE);
    }

    await expect(service.expire()).resolves.toEqual(
      expect.objectContaining({ complete: false }),
    );
  });

  describe('erase (FC-038)', () => {
    it('deletes the files of the imports named now, retiring a held one as erased', async () => {
      seed(1, FileAssetPlacementState.HELD, {
        retainUntil: new Date(Date.now() + 100 * DAY),
      });
      seed(2, FileAssetPlacementState.ACTIVE, {
        retainUntil: new Date(Date.now() + 100 * DAY),
      });
      seed(3, FileAssetPlacementState.ACTIVE, {
        state: FileAssetState.DELETED,
      });

      await expect(
        service.erase(['import-1', 'import-2', 'import-3']),
      ).resolves.toEqual({
        deleted: 2,
        retired: 1,
        notDeleted: 0,
        fleetIds: [FLEET_ID],
      });
      expect(asset(1)).toEqual(
        expect.objectContaining({
          state: FileAssetState.DELETED,
          revocationReason: ROSTER_SOURCE_ERASED_REASON,
        }),
      );
      expect(db.rows(RosterImportActionEntity)).toEqual([
        expect.objectContaining({
          action: RosterImportActionKind.SOURCE_ERASED,
          importSourceId: 'import-1',
        }),
      ]);
    });

    it('leaves a file it could not delete due tonight', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      seed(1, FileAssetPlacementState.ACTIVE, {
        retainUntil: new Date(Date.now() + 100 * DAY),
      });
      quarantine.remove.mockRejectedValueOnce(new Error('R2 is down'));

      await expect(service.erase(['import-1'])).resolves.toEqual(
        expect.objectContaining({ deleted: 0, notDeleted: 1 }),
      );
      expect((asset(1).retainUntil as Date).getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
    });

    it('does nothing for no imports', async () => {
      await expect(service.erase([])).resolves.toEqual({
        deleted: 0,
        retired: 0,
        notDeleted: 0,
        fleetIds: [],
      });
    });
  });
});
