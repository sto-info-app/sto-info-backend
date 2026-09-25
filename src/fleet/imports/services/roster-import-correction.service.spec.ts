import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { DataSource, EntityTarget, FindOperator } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetPublicationQueueService } from 'src/file-assets/services/asset-publication-queue.service';

import { RosterReplayQueueService } from '../../projection/services/roster-replay-queue.service';
import { RosterImportActionEntity } from '../entities/roster-import-action.entity';
import { RosterImportConflictEntity } from '../entities/roster-import-conflict.entity';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterObservationEntity } from '../entities/roster-observation.entity';
import { RosterImportActionKind } from '../enums/roster-import-action-kind.enum';
import { RosterImportCorrectionService } from './roster-import-correction.service';
import { RosterImportStatusService } from './roster-import-status.service';

const FLEET_ID = 'fleet-1';
const IMPORT_ID = 'import-1';
const USER_ID = 'user-1';
const REASON = 'Exported from the wrong Fleet';

type Row = Record<string, unknown>;

describe('RosterImportCorrectionService', () => {
  let record: Row | null;
  let placementState: FileAssetPlacementState | null;
  let rows: Row[];
  let order: string[];
  let manager: Record<string, jest.Mock>;
  let replays: { request: jest.Mock; enqueue: jest.Mock };
  let status: { detail: jest.Mock };
  let publications: { enqueue: jest.Mock };
  let group: Row;
  let service: RosterImportCorrectionService;

  beforeEach(() => {
    record = {
      id: IMPORT_ID,
      fleetId: FLEET_ID,
      assetId: 'asset-1',
      excluded: false,
      partial: false,
    };
    placementState = FileAssetPlacementState.ACTIVE;
    rows = [
      { id: 'row-2', line: 2, excluded: false },
      { id: 'row-3', line: 3, excluded: false },
      { id: 'row-4', line: 4, excluded: true },
    ];
    order = [];

    manager = {
      findOne: jest.fn((entity: EntityTarget<unknown>) => {
        if (entity === RosterImportSourceEntity) {
          return Promise.resolve(record === null ? null : { ...record });
        }

        return Promise.resolve(
          placementState === null ? null : { state: placementState },
        );
      }),
      find: jest.fn((_entity: EntityTarget<unknown>, options: Row) => {
        const lines = ((options.where as Row).line as FindOperator<number[]>)
          .value as unknown as number[];

        return Promise.resolve(
          rows.filter(row => lines.includes(row.line as number)),
        );
      }),
      update: jest.fn(() => {
        order.push('update');

        return Promise.resolve();
      }),
      insert: jest.fn(() => {
        order.push('insert');

        return Promise.resolve();
      }),
      findOneOrFail: jest.fn(() => Promise.resolve({ ...group })),
    };
    group = { id: 'group-1', selectedImportId: null, resolvedAt: null };
    publications = {
      enqueue: jest.fn(() => {
        order.push('publish');

        return Promise.resolve();
      }),
    };
    replays = {
      request: jest.fn(() => {
        order.push('request');

        return Promise.resolve();
      }),
      enqueue: jest.fn(() => {
        order.push('enqueue');

        return Promise.resolve();
      }),
    };
    status = {
      detail: jest.fn(() => Promise.resolve({ id: IMPORT_ID })),
    };

    service = new RosterImportCorrectionService(
      {
        transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
          work(manager),
        ),
      } as unknown as DataSource,
      replays as unknown as RosterReplayQueueService,
      status as unknown as RosterImportStatusService,
      publications as unknown as AssetPublicationQueueService,
    );

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The action the correction recorded. */
  const recorded = (): Row =>
    (manager.insert.mock.calls as Array<[unknown, Row]>).find(
      ([entity]) => entity === RosterImportActionEntity,
    )![1];

  describe('every correction', () => {
    it('locks the import within its Fleet', async () => {
      await service.exclude(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON });

      expect(manager.findOne).toHaveBeenCalledWith(RosterImportSourceEntity, {
        where: { id: IMPORT_ID, fleetId: FLEET_ID },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('reports an import the Fleet does not have as not found', async () => {
      record = null;

      await expect(
        service.exclude(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(replays.request).not.toHaveBeenCalled();
    });

    it('asks after the import’s own placement', async () => {
      await service.exclude(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON });

      expect(manager.findOne).toHaveBeenCalledWith(FileAssetPlacementEntity, {
        where: {
          subject: FileAssetSubject.ROSTER_IMPORT,
          subjectId: IMPORT_ID,
          assetId: 'asset-1',
        },
        select: { state: true },
      });
    });

    // One still scanning, refused or given up on has never counted.
    it.each([
      FileAssetPlacementState.PENDING,
      FileAssetPlacementState.REJECTED,
      FileAssetPlacementState.ABANDONED,
      null,
    ])('refuses an import whose placement is %s', async state => {
      placementState = state;

      await expect(
        service.exclude(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON }),
      ).rejects.toThrow(/Only an import in force/);
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('corrects one waiting on a conflicting export', async () => {
      placementState = FileAssetPlacementState.HELD;

      await expect(
        service.exclude(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON }),
      ).resolves.toEqual({ id: IMPORT_ID });
    });

    // The change, its record and the request commit together; the job is
    // queued only once they have.
    it('records who, why and what, asks for a replay, and queues it after', async () => {
      await service.exclude(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON });

      expect(recorded()).toEqual({
        fleetId: FLEET_ID,
        importSourceId: IMPORT_ID,
        conflictGroupId: null,
        action: RosterImportActionKind.EXCLUDED,
        actorUserId: USER_ID,
        reason: REASON,
        detail: null,
      });
      expect(replays.request).toHaveBeenCalledWith(manager, FLEET_ID);
      expect(order).toEqual(['update', 'insert', 'request', 'enqueue']);
      expect(replays.enqueue).toHaveBeenCalledWith(FLEET_ID);
    });

    it('answers with the import as an investigator now sees it', async () => {
      await service.exclude(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON });

      expect(status.detail).toHaveBeenCalledWith(FLEET_ID, IMPORT_ID, true);
    });
  });

  describe('exclusion', () => {
    it('takes the import out of the history', async () => {
      await service.exclude(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON });

      expect(manager.update).toHaveBeenCalledWith(
        RosterImportSourceEntity,
        { id: IMPORT_ID },
        { excluded: true },
      );
    });

    it('refuses an import already excluded', async () => {
      record!.excluded = true;

      await expect(
        service.exclude(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON }),
      ).rejects.toThrow(
        new ConflictException('This import is already excluded.'),
      );
      expect(replays.enqueue).not.toHaveBeenCalled();
    });

    it('puts an excluded import back', async () => {
      record!.excluded = true;

      await service.reinstate(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON });

      expect(manager.update).toHaveBeenCalledWith(
        RosterImportSourceEntity,
        { id: IMPORT_ID },
        { excluded: false },
      );
      expect(recorded().action).toBe(RosterImportActionKind.REINSTATED);
    });

    it('refuses to reinstate an import that is not excluded', async () => {
      await expect(
        service.reinstate(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON }),
      ).rejects.toThrow(new ConflictException('This import is not excluded.'));
    });
  });

  describe('the partial mark', () => {
    it.each([
      [true, false, RosterImportActionKind.MARKED_PARTIAL],
      [false, true, RosterImportActionKind.UNMARKED_PARTIAL],
    ])(
      'records partial %s on an import that was %s',
      async (partial, was, action) => {
        record!.partial = was;

        await service.markPartial(FLEET_ID, IMPORT_ID, USER_ID, {
          partial,
          reason: REASON,
        });

        expect(manager.update).toHaveBeenCalledWith(
          RosterImportSourceEntity,
          { id: IMPORT_ID },
          { partial },
        );
        expect(recorded().action).toBe(action);
      },
    );

    it.each([
      [true, 'This import is already marked partial.'],
      [false, 'This import is not marked partial.'],
    ])('refuses to set partial %s again', async (partial, message) => {
      record!.partial = partial;

      await expect(
        service.markPartial(FLEET_ID, IMPORT_ID, USER_ID, {
          partial,
          reason: REASON,
        }),
      ).rejects.toThrow(new ConflictException(message));
    });
  });

  describe('selecting an export', () => {
    const select = () =>
      service.select(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON });

    beforeEach(() => {
      record!.conflictGroupId = 'group-1';
    });

    it('settles the group on it, locking the group', async () => {
      await select();

      expect(manager.findOneOrFail).toHaveBeenCalledWith(
        RosterImportConflictEntity,
        { where: { id: 'group-1' }, lock: { mode: 'pessimistic_write' } },
      );
      expect(manager.update).toHaveBeenCalledWith(
        RosterImportConflictEntity,
        { id: 'group-1' },
        { selectedImportId: IMPORT_ID, resolvedAt: expect.any(Date) },
      );
      expect(recorded()).toMatchObject({
        action: RosterImportActionKind.CONFLICT_SELECTED,
        conflictGroupId: 'group-1',
        detail: null,
      });
    });

    // Steve's decision of 25 September 2026: a selection can be changed.
    it('replaces an earlier selection', async () => {
      group.selectedImportId = 'import-other';

      await expect(select()).resolves.toEqual({ id: IMPORT_ID });
    });

    it('queues the replay at once for an export already in force', async () => {
      await select();

      expect(order).toEqual(['update', 'insert', 'request', 'enqueue']);
      expect(publications.enqueue).not.toHaveBeenCalled();
    });

    // A held export has never been read. Its publication reads it into
    // force, and its going into force queues the replay; queuing one now
    // would publish a revision with nothing read for the moment.
    it('queues a held export to be read, and leaves the replay to its going into force', async () => {
      placementState = FileAssetPlacementState.HELD;

      await select();

      expect(order).toEqual(['update', 'insert', 'request', 'publish']);
      expect(publications.enqueue).toHaveBeenCalledWith('asset-1');
      expect(replays.enqueue).not.toHaveBeenCalled();
      expect(replays.request).toHaveBeenCalledWith(manager, FLEET_ID);
    });

    it('refuses an import no other export disputes', async () => {
      record!.conflictGroupId = null;

      await expect(select()).rejects.toThrow(/nothing to select between/);
      expect(manager.findOneOrFail).not.toHaveBeenCalled();
    });

    it('refuses an excluded import', async () => {
      record!.excluded = true;

      await expect(select()).rejects.toThrow(/Reinstate it before selecting/);
    });

    it('refuses the export already selected', async () => {
      group.selectedImportId = IMPORT_ID;

      await expect(select()).rejects.toThrow(
        new ConflictException('This export is already the one selected.'),
      );
      expect(manager.insert).not.toHaveBeenCalled();
    });
  });

  describe('row exclusion', () => {
    it('excludes the rows on the lines named, and records them in order', async () => {
      await service.excludeRows(FLEET_ID, IMPORT_ID, USER_ID, {
        lines: [3, 2],
        excluded: true,
        reason: REASON,
      });

      expect(manager.find).toHaveBeenCalledWith(RosterObservationEntity, {
        where: {
          importSourceId: IMPORT_ID,
          line: expect.any(FindOperator),
        },
        select: { id: true, line: true, excluded: true },
      });
      expect(manager.update).toHaveBeenCalledWith(
        RosterObservationEntity,
        { id: expect.objectContaining({ _value: ['row-2', 'row-3'] }) },
        { excluded: true },
      );
      expect(recorded()).toMatchObject({
        action: RosterImportActionKind.ROWS_EXCLUDED,
        detail: { lines: [2, 3] },
      });
    });

    it('puts excluded rows back', async () => {
      await service.excludeRows(FLEET_ID, IMPORT_ID, USER_ID, {
        lines: [4],
        excluded: false,
        reason: REASON,
      });

      expect(recorded()).toMatchObject({
        action: RosterImportActionKind.ROWS_REINSTATED,
        detail: { lines: [4] },
      });
    });

    it('refuses a line that names no row, saying which', async () => {
      await expect(
        service.excludeRows(FLEET_ID, IMPORT_ID, USER_ID, {
          lines: [9, 2, 7],
          excluded: true,
          reason: REASON,
        }),
      ).rejects.toThrow(
        new BadRequestException('This import has no row on line 7, 9.'),
      );
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('refuses the whole request when a row is already as asked', async () => {
      await expect(
        service.excludeRows(FLEET_ID, IMPORT_ID, USER_ID, {
          lines: [2, 4],
          excluded: true,
          reason: REASON,
        }),
      ).rejects.toThrow(
        new ConflictException('The row on line 4 is already excluded.'),
      );
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('says a row put back twice is already counted', async () => {
      await expect(
        service.excludeRows(FLEET_ID, IMPORT_ID, USER_ID, {
          lines: [3, 2],
          excluded: false,
          reason: REASON,
        }),
      ).rejects.toThrow(
        new ConflictException('The row on line 2, 3 is already counted.'),
      );
    });

    // A held import is read only once it is selected.
    it('refuses rows of an import that has not been read', async () => {
      placementState = FileAssetPlacementState.HELD;

      await expect(
        service.excludeRows(FLEET_ID, IMPORT_ID, USER_ID, {
          lines: [2],
          excluded: true,
          reason: REASON,
        }),
      ).rejects.toThrow(/rows have not been read/);
      expect(manager.find).not.toHaveBeenCalled();
    });
  });
});
