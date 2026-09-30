import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { DataSource, EntityTarget, FindOperator } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetPublicationQueueService } from 'src/file-assets/services/asset-publication-queue.service';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';

import { RosterReplayQueueService } from '../../projection/services/roster-replay-queue.service';
import { RosterImportActionEntity } from '../entities/roster-import-action.entity';
import { RosterImportConflictEntity } from '../entities/roster-import-conflict.entity';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterObservationEntity } from '../entities/roster-observation.entity';
import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterFilenameRejectionCode } from '../enums/roster-filename-rejection-code.enum';
import { RosterImportActionKind } from '../enums/roster-import-action-kind.enum';
import { RosterRowRejectionCode } from '../enums/roster-row-rejection-code.enum';
import { RosterImportConflictService } from './roster-import-conflict.service';
import { RosterImportCorrectionService } from './roster-import-correction.service';
import { RosterImportStatusService } from './roster-import-status.service';
import { RosterTypedParserService } from './roster-typed-parser.service';

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
  let conflicts: { group: jest.Mock };
  let quarantine: { read: jest.Mock };
  let typedParser: { read: jest.Mock };
  let group: Row;
  let service: RosterImportCorrectionService;

  beforeEach(() => {
    record = {
      id: IMPORT_ID,
      fleetId: FLEET_ID,
      assetId: 'asset-1',
      excluded: false,
      partial: false,
      conflictGroupId: null,
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
      findOneOrFail: jest.fn((entity: EntityTarget<unknown>) =>
        Promise.resolve(
          entity === FileAssetEntity
            ? {
                id: 'asset-1',
                objectKey: 'quarantine/asset-1',
                objectVersion: 'v1',
              }
            : { ...group },
        ),
      ),
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
    conflicts = { group: jest.fn(() => Promise.resolve(null)) };
    quarantine = { read: jest.fn(() => Promise.resolve(Buffer.from('csv'))) };
    typedParser = { read: jest.fn(() => ({ rows: [], problems: [] })) };

    service = new RosterImportCorrectionService(
      {
        transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
          work(manager),
        ),
      } as unknown as DataSource,
      replays as unknown as RosterReplayQueueService,
      status as unknown as RosterImportStatusService,
      publications as unknown as AssetPublicationQueueService,
      conflicts as unknown as RosterImportConflictService,
      quarantine as unknown as QuarantineStorageService,
      typedParser as unknown as RosterTypedParserService,
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

    it('refuses one retired when its file expired (FC-037)', async () => {
      placementState = FileAssetPlacementState.WITHDRAWN;

      await expect(
        service.select(FLEET_ID, IMPORT_ID, USER_ID, { reason: REASON }),
      ).rejects.toThrow(/file has been deleted/);
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

  describe('correcting a timezone', () => {
    let observations: Row[];
    let claimants: Row[];
    /** The other exports of the import's group. */
    let members: Row[];
    /** Each other export's placement, by import. */
    let memberStates: Record<string, FileAssetPlacementState | null>;

    /** The refusal body a request met, or the result it got. */
    const correct = (timezone: string, exportedAt?: string) =>
      service.correctTimezone(FLEET_ID, IMPORT_ID, USER_ID, {
        timezone,
        exportedAt,
        reason: REASON,
      });

    const refusal = async (
      promise: Promise<unknown>,
    ): Promise<Record<string, unknown>> => {
      try {
        await promise;
      } catch (error) {
        return (error as BadRequestException).getResponse() as Record<
          string,
          unknown
        >;
      }

      throw new Error('Expected a refusal');
    };

    beforeEach(() => {
      Object.assign(record!, {
        exportTimezone: 'UTC',
        exportLocalStamp: '2024-11-01T12:00:00',
        exportedAt: new Date('2024-11-01T12:00:00Z'),
        originalFilename: 'Fleet_20241101-120000.Csv',
      });
      observations = [
        {
          id: 'row-2',
          line: 2,
          joinedAtLocal: '2022-01-09T18:20:00',
          rankChangedAtLocal: null,
          lastActiveAtLocal: '2024-10-27T01:30:00',
          publicCommentEditedAtLocal: null,
        },
        {
          id: 'row-3',
          line: 3,
          joinedAtLocal: null,
          rankChangedAtLocal: null,
          lastActiveAtLocal: null,
          publicCommentEditedAtLocal: null,
        },
      ];
      claimants = [];
      members = [];
      memberStates = {};
      manager.find.mockImplementation(
        (entity: EntityTarget<unknown>, options: { where: Row }) => {
          if (entity === RosterObservationEntity) {
            return Promise.resolve(observations) as never;
          }

          return Promise.resolve(
            'conflictGroupId' in options.where ? members : claimants,
          ) as never;
        },
      );
      manager.findOne.mockImplementation(
        (entity: EntityTarget<unknown>, options: { where: Row }) => {
          if (entity === RosterImportSourceEntity) {
            return Promise.resolve({ ...record });
          }

          const state =
            options.where.subjectId === IMPORT_ID
              ? placementState
              : memberStates[options.where.subjectId as string];

          return Promise.resolve(state === null ? null : { state });
        },
      );
      manager.query = jest.fn(() => Promise.resolve([]));
    });

    it('reads the stamp again through the zone, and records both readings', async () => {
      await correct('America/New_York');

      expect(manager.update).toHaveBeenCalledWith(
        RosterImportSourceEntity,
        { id: IMPORT_ID },
        {
          exportTimezone: 'America/New_York',
          exportedAt: new Date('2024-11-01T16:00:00Z'),
          exportedAtAmbiguous: false,
          conflictGroupId: null,
        },
      );
      expect(recorded()).toMatchObject({
        action: RosterImportActionKind.TIMEZONE_CORRECTED,
        detail: {
          fromTimezone: 'UTC',
          toTimezone: 'America/New_York',
          fromExportedAt: '2024-11-01T12:00:00.000Z',
          toExportedAt: '2024-11-01T16:00:00.000Z',
        },
      });
    });

    // The last-active time falls in the hour London's clocks went back,
    // so it names two moments: the earlier is kept, and flagged.
    it('reads every date in the rows again, from the local text', async () => {
      await correct('Europe/London');

      expect(manager.update).toHaveBeenCalledWith(
        RosterObservationEntity,
        { id: 'row-2' },
        {
          joinedAt: new Date('2022-01-09T18:20:00Z'),
          joinedAtAmbiguous: false,
          lastActiveAt: new Date('2024-10-27T00:30:00Z'),
          lastActiveAtAmbiguous: true,
        },
      );
      // A row with no dates has nothing to re-read.
      expect(manager.update).not.toHaveBeenCalledWith(
        RosterObservationEntity,
        { id: 'row-3' },
        expect.anything(),
      );
    });

    it('records no earlier instant for an import that never had one', async () => {
      record!.exportedAt = null;

      await correct('America/New_York');

      expect(recorded()).toMatchObject({
        detail: { fromExportedAt: null },
      });
    });

    it('takes the lock an upload claiming the new moment takes', async () => {
      await correct('America/New_York');

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`fleet-roster-export:${FLEET_ID}:2024-11-01T16:00:00.000Z`],
      );
    });

    it('refuses a moment another export already claims, naming it', async () => {
      claimants = [
        {
          id: 'import-9',
          originalFilename: 'Fleet_20241101-160000.Csv',
          asset: { state: FileAssetState.AVAILABLE },
        },
      ];

      await expect(correct('America/New_York')).rejects.toThrow(
        new ConflictException(
          'Another export of this Fleet, Fleet_20241101-160000.Csv, already ' +
            'claims that moment.',
        ),
      );
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('pays no attention to a refused export at that moment', async () => {
      claimants = [
        { id: 'import-9', asset: { state: FileAssetState.REJECTED } },
      ];

      await expect(correct('America/New_York')).resolves.toEqual({
        id: IMPORT_ID,
      });
    });

    // One group per moment, ever: a moment whose exports have all moved
    // away keeps its group, and an export moving there joins it as an
    // upload of that moment would.
    it('puts it in whatever group its new moment has, as an upload would', async () => {
      await correct('America/New_York');

      expect(conflicts.group).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          id: IMPORT_ID,
          exportedAt: new Date('2024-11-01T16:00:00Z'),
        }),
        new Date('2024-11-01T16:00:00Z'),
      );
      expect(replays.enqueue).toHaveBeenCalledWith(FLEET_ID);
      expect(publications.enqueue).not.toHaveBeenCalled();
    });

    // Steve's decision of 30 September 2026: a held export is corrected at
    // once. It has no rows yet, so its stored file is read through the new
    // zone first, as the publisher will read it.
    describe('a held export', () => {
      beforeEach(() => {
        placementState = FileAssetPlacementState.HELD;
      });

      it('reads its file through the new zone, then corrects it and queues it to be read', async () => {
        await expect(correct('America/New_York')).resolves.toEqual({
          id: IMPORT_ID,
        });

        expect(quarantine.read).toHaveBeenCalledWith(
          'quarantine/asset-1',
          'v1',
        );
        expect(typedParser.read).toHaveBeenCalledWith(
          Buffer.from('csv'),
          'America/New_York',
        );
        expect(manager.find).not.toHaveBeenCalledWith(
          RosterObservationEntity,
          expect.anything(),
        );
        expect(publications.enqueue).toHaveBeenCalledWith(record!.assetId);
        expect(replays.enqueue).not.toHaveBeenCalled();
      });

      it('refuses when a date in its file never happened there, changing nothing', async () => {
        const problem = {
          code: RosterRowRejectionCode.DATE_NONEXISTENT,
          line: 4,
          column: 'Last Active Date',
        };

        typedParser.read.mockReturnValue({ rows: [], problems: [problem] });

        await expect(refusal(correct('America/New_York'))).resolves.toEqual(
          expect.objectContaining({
            code: RosterCsvRejectionCode.ROWS_UNREADABLE,
            problems: [problem],
          }),
        );
        expect(manager.update).not.toHaveBeenCalled();
        expect(publications.enqueue).not.toHaveBeenCalled();
      });
    });

    describe('in a conflict group', () => {
      beforeEach(() => {
        record!.conflictGroupId = 'group-1';
        members = [
          { id: 'import-2', assetId: 'asset-2' },
          { id: 'import-3', assetId: 'asset-3' },
        ];
        memberStates = {
          'import-2': FileAssetPlacementState.HELD,
          'import-3': FileAssetPlacementState.ACTIVE,
        };
      });

      it('locks the group, as a selection does', async () => {
        await correct('America/New_York');

        expect(manager.findOneOrFail).toHaveBeenCalledWith(
          RosterImportConflictEntity,
          { where: { id: 'group-1' }, lock: { mode: 'pessimistic_write' } },
        );
      });

      // Steve's decision of 30 September 2026: a wrong clock is why it
      // clashed, so correcting it is the answer, not something to wait for.
      it('corrects it while nobody has chosen, and takes it out of the group', async () => {
        await expect(correct('America/New_York')).resolves.toEqual({
          id: IMPORT_ID,
        });
        expect(manager.update).toHaveBeenCalledWith(
          RosterImportSourceEntity,
          { id: IMPORT_ID },
          expect.objectContaining({ conflictGroupId: null }),
        );
        expect(manager.update).not.toHaveBeenCalledWith(
          RosterImportConflictEntity,
          expect.anything(),
          expect.anything(),
        );
      });

      // The publisher decides afresh which of the rest stands now this one
      // has gone; one already in force is left as it is.
      it('publishes again the held exports it leaves behind', async () => {
        await correct('America/New_York');

        expect(manager.find).toHaveBeenCalledWith(RosterImportSourceEntity, {
          where: { conflictGroupId: 'group-1', id: expect.any(FindOperator) },
        });
        expect(publications.enqueue).toHaveBeenCalledWith('asset-2');
        expect(publications.enqueue).not.toHaveBeenCalledWith('asset-3');
        expect(replays.enqueue).toHaveBeenCalledWith(FLEET_ID);
      });

      // Two exports never stand for one moment, and a group only selects its
      // own: the selection goes before the export does, and the moment falls
      // back to the first version the site saw.
      it('takes the selection with it when it was the one selected', async () => {
        group.resolvedAt = new Date();
        group.selectedImportId = IMPORT_ID;

        await correct('America/New_York');

        expect(manager.update).toHaveBeenCalledWith(
          RosterImportConflictEntity,
          { id: 'group-1' },
          { selectedImportId: null, resolvedAt: null },
        );
        expect(
          (manager.update.mock.calls as Array<[unknown]>)
            .map(([entity]) => entity)
            .filter(entity => entity !== RosterObservationEntity),
        ).toEqual([RosterImportConflictEntity, RosterImportSourceEntity]);
      });

      it('leaves another export’s selection standing', async () => {
        group.resolvedAt = new Date();
        group.selectedImportId = 'import-3';

        await correct('America/New_York');

        expect(manager.update).not.toHaveBeenCalledWith(
          RosterImportConflictEntity,
          expect.anything(),
          expect.anything(),
        );
      });
    });

    it('asks after no group when it is in none', async () => {
      await correct('America/New_York');

      expect(manager.findOneOrFail).not.toHaveBeenCalledWith(
        RosterImportConflictEntity,
        expect.anything(),
      );
      expect(manager.find).not.toHaveBeenCalledWith(
        RosterImportSourceEntity,
        expect.objectContaining({
          where: expect.objectContaining({
            conflictGroupId: expect.anything(),
          }),
        }),
      );
    });

    it('refuses the zone it is already read through, however it is spelled', async () => {
      record!.exportTimezone = 'Europe/London';

      await expect(correct('europe/london')).rejects.toThrow(
        new ConflictException(
          'This import is already read through that timezone.',
        ),
      );
    });

    it('refuses an import with no export time to read', async () => {
      record!.exportLocalStamp = null;

      await expect(correct('America/New_York')).rejects.toThrow(
        /no export time/,
      );
    });

    it('refuses a stamp that never happened in that zone', async () => {
      record!.exportLocalStamp = '2024-03-31T01:30:00';

      await expect(refusal(correct('Europe/London'))).resolves.toEqual({
        message:
          'Through that timezone this export cannot be read, so nothing ' +
          'was corrected.',
        code: RosterFilenameRejectionCode.STAMP_NONEXISTENT,
        line: null,
        problems: [],
      });
    });

    describe('a stamp that names two moments in that zone', () => {
      beforeEach(() => {
        record!.exportLocalStamp = '2024-10-27T01:30:00';
      });

      it('has to be told which', async () => {
        await expect(refusal(correct('Europe/London'))).resolves.toMatchObject({
          code: RosterFilenameRejectionCode.STAMP_CHOICE_REQUIRED,
        });
      });

      it('takes the one it is told, and records that it was chosen', async () => {
        await correct('Europe/London', '2024-10-27T01:30:00.000Z');

        expect(manager.update).toHaveBeenCalledWith(
          RosterImportSourceEntity,
          { id: IMPORT_ID },
          expect.objectContaining({
            exportedAt: new Date('2024-10-27T01:30:00Z'),
            exportedAtAmbiguous: true,
          }),
        );
      });

      it('refuses a moment that is neither of the two', async () => {
        await expect(
          refusal(correct('Europe/London', '2024-10-27T03:00:00.000Z')),
        ).resolves.toMatchObject({
          code: RosterFilenameRejectionCode.STAMP_CHOICE_NOT_A_CANDIDATE,
        });
      });
    });

    it('refuses a moment chosen for a stamp that names only one', async () => {
      await expect(
        refusal(correct('America/New_York', '2024-11-01T12:00:00.000Z')),
      ).resolves.toMatchObject({
        code: RosterFilenameRejectionCode.STAMP_CHOICE_NOT_A_CANDIDATE,
      });
    });

    it('accepts the moment chosen when it is the only one', async () => {
      await expect(
        correct('America/New_York', '2024-11-01T16:00:00.000Z'),
      ).resolves.toEqual({ id: IMPORT_ID });
    });

    it('refuses the whole correction when a date never happened there, saying where', async () => {
      observations[1].joinedAtLocal = '2024-03-31T01:30:00';

      await expect(refusal(correct('Europe/London'))).resolves.toMatchObject({
        code: RosterCsvRejectionCode.ROWS_UNREADABLE,
        problems: [
          {
            code: RosterRowRejectionCode.DATE_NONEXISTENT,
            line: 3,
            column: 'Join Date',
          },
        ],
      });
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('reads only the local text of each row, in line order', async () => {
      await correct('America/New_York');

      expect(manager.find).toHaveBeenCalledWith(RosterObservationEntity, {
        where: { importSourceId: IMPORT_ID },
        select: {
          id: true,
          line: true,
          joinedAtLocal: true,
          rankChangedAtLocal: true,
          lastActiveAtLocal: true,
          publicCommentEditedAtLocal: true,
        },
        order: { line: 'ASC' },
      });
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
