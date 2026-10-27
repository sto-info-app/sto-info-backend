import { Logger, NotFoundException } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { FindOperator, Not, Repository } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetPlacementService } from 'src/file-assets/services/file-asset-placement.service';
import { RosterSortDirection } from 'src/fleet/roster/enums/roster-sort.enum';
import { UserEntity } from 'src/user/entities/user.entity';

import { RosterImportActionEntity } from '../entities/roster-import-action.entity';
import { RosterImportConflictEntity } from '../entities/roster-import-conflict.entity';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterObservationEntity } from '../entities/roster-observation.entity';
import { RosterImportActionKind } from '../enums/roster-import-action-kind.enum';
import { RosterImportConflictFilter } from '../enums/roster-import-conflict-filter.enum';
import { RosterImportRowSort } from '../enums/roster-import-row-sort.enum';
import { RosterImportStatus } from '../enums/roster-import-status.enum';
import { RosterRowRejectionCode } from '../enums/roster-row-rejection-code.enum';
import { RosterSourceHeaderShape } from '../enums/roster-source-header-shape.enum';
import {
  RosterImportStatusService,
  SCAN_NOT_COMPLETED,
  SCAN_REFUSED,
} from './roster-import-status.service';
import { ROSTER_SOURCE_ERASED_REASON } from './roster-source-retention.service';

const FLEET_ID = 'fleet-1';
const UPLOADED_AT = new Date('2026-09-19T00:00:00.000Z');
const EXPORTED_AT = new Date('2024-01-01T12:00:00.000Z');
const RETAIN_UNTIL = new Date('2027-03-18T00:00:00.000Z');

/** What every read of an import loads beside it. */
const RELATIONS = { asset: true, uploadedBy: { profile: true } };

/**
 * Builds an import as the repository returns it, with its asset and uploader.
 *
 * @param overrides - Whatever the case is actually about.
 * @param asset - Changes to its asset.
 * @returns The import.
 */
function importOf(
  overrides: Partial<RosterImportSourceEntity> = {},
  asset: Partial<FileAssetEntity> = {},
): RosterImportSourceEntity {
  const id = overrides.id ?? 'import-1';

  return {
    id,
    assetId: `asset-of-${id}`,
    fleetId: FLEET_ID,
    originalFilename: 'Fixture Basic Fleet_20240101-120000.Csv',
    sourceSha256: 'a'.repeat(64),
    sanitisedSha256: 'b'.repeat(64),
    sourceByteSize: '4096',
    sanitisedByteSize: '2048',
    sourceHeaderShape: RosterSourceHeaderShape.OFFICER,
    exportTimezone: 'Europe/London',
    exportLocalStamp: '2024-01-01T12:00:00',
    exportedAt: EXPORTED_AT,
    exportedAtAmbiguous: false,
    rowCount: 93,
    officerTailRowCount: 7,
    parserVersion: 1,
    publicationProblems: null,
    conflictGroupId: null,
    uploadedAt: UPLOADED_AT,
    uploadedBy: { profile: { username: 'kmarr' } } as UserEntity,
    excluded: false,
    partial: false,
    ...overrides,
    asset: {
      id: `asset-of-${id}`,
      state: FileAssetState.QUARANTINED,
      rejectionCode: null,
      retainUntil: RETAIN_UNTIL,
      ...asset,
    } as FileAssetEntity,
  } as RosterImportSourceEntity;
}

/**
 * Builds the placement an import claimed.
 *
 * @param record - The import.
 * @param state - What publication made of it.
 * @returns The placement.
 */
function placementOf(
  record: RosterImportSourceEntity,
  state: FileAssetPlacementState,
): FileAssetPlacementEntity {
  return { assetId: record.assetId, state } as FileAssetPlacementEntity;
}

describe('RosterImportStatusService', () => {
  let imports: {
    findAndCount: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    findOne: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    find: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };
  let placements: {
    findByAssetIds: jest.Mock<
      (...args: unknown[]) => Promise<FileAssetPlacementEntity[]>
    >;
    findByAssetId: jest.Mock<
      (...args: unknown[]) => Promise<FileAssetPlacementEntity | null>
    >;
  };
  let observations: {
    find: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    findAndCount: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    createQueryBuilder?: jest.Mock<(...args: unknown[]) => unknown>;
    manager?: { find: jest.Mock<(...args: unknown[]) => Promise<unknown>> };
  };
  let actions: { find: jest.Mock<(...args: unknown[]) => Promise<unknown>> };
  let conflicts: {
    findOne: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    findAndCount: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };
  let service: RosterImportStatusService;
  let warn: jest.SpiedFunction<(message: unknown) => void>;

  /**
   * Reports one import in whatever state its asset and placement are in.
   *
   * @param record - The import.
   * @param placement - Its placement, or none.
   * @returns What it is reported as.
   */
  async function report(
    record: RosterImportSourceEntity,
    placement: FileAssetPlacementState | null,
  ): Promise<{ status: RosterImportStatus; statusReason: string | null }> {
    imports.findOne.mockResolvedValue(record);
    placements.findByAssetIds.mockResolvedValue(
      placement === null ? [] : [placementOf(record, placement)],
    );

    const { status, statusReason } = await service.summary(FLEET_ID, record.id);

    return { status, statusReason };
  }

  beforeEach(() => {
    imports = {
      findAndCount: jest.fn(() => Promise.resolve([[], 0])),
      findOne: jest.fn(() => Promise.resolve(importOf())),
      find: jest.fn(() => Promise.resolve([])),
    };
    placements = {
      findByAssetIds: jest.fn(() => Promise.resolve([])),
      findByAssetId: jest.fn(() => Promise.resolve(null)),
    };

    observations = {
      find: jest.fn(() => Promise.resolve([])),
      findAndCount: jest.fn(() => Promise.resolve([[], 0])),
    };
    actions = { find: jest.fn(() => Promise.resolve([])) };
    conflicts = {
      findOne: jest.fn(() => Promise.resolve(null)),
      findAndCount: jest.fn(() => Promise.resolve([[], 0])),
    };

    service = new RosterImportStatusService(
      imports as unknown as Repository<RosterImportSourceEntity>,
      placements as unknown as FileAssetPlacementService,
      observations as unknown as Repository<RosterObservationEntity>,
      actions as unknown as Repository<RosterImportActionEntity>,
      conflicts as unknown as Repository<RosterImportConflictEntity>,
    );

    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('list', () => {
    it("reads the Fleet's imports newest first, a page at a time", async () => {
      await service.list(FLEET_ID, 3, 10);

      expect(imports.findAndCount).toHaveBeenCalledWith({
        where: { fleetId: FLEET_ID },
        relations: RELATIONS,
        order: { uploadedAt: 'DESC', id: 'DESC' },
        skip: 20,
        take: 10,
      });
    });

    it('reads the first page of twenty when not told otherwise', async () => {
      await expect(service.list(FLEET_ID)).resolves.toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
      expect(imports.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('never hands back more than fifty at once', async () => {
      await expect(service.list(FLEET_ID, 1, 500)).resolves.toEqual(
        expect.objectContaining({ pageSize: 50 }),
      );
    });

    // One question for the page, not one per row.
    it('asks about every placement on the page at once', async () => {
      const first = importOf({ id: 'import-1' });
      const second = importOf({ id: 'import-2' });

      imports.findAndCount.mockResolvedValue([[first, second], 7]);
      placements.findByAssetIds.mockResolvedValue([
        placementOf(second, FileAssetPlacementState.ACTIVE),
        placementOf(first, FileAssetPlacementState.PENDING),
      ]);

      const page = await service.list(FLEET_ID);

      expect(placements.findByAssetIds).toHaveBeenCalledTimes(1);
      expect(placements.findByAssetIds).toHaveBeenCalledWith([
        'asset-of-import-1',
        'asset-of-import-2',
      ]);
      expect(page.total).toBe(7);
      expect(page.items.map(item => [item.id, item.status])).toEqual([
        ['import-1', RosterImportStatus.SCANNING],
        ['import-2', RosterImportStatus.IMPORTED],
      ]);
    });
  });

  // For the upload that asks whether an earlier import of the same file may
  // be replaced: one whose file was never read (FC-050).
  describe('mayBeReplaced', () => {
    it('asks about the one import’s placement', async () => {
      const record = importOf();
      placements.findByAssetId.mockResolvedValue(
        placementOf(record, FileAssetPlacementState.ABANDONED),
      );

      await expect(service.mayBeReplaced(record)).resolves.toBe(true);
      expect(placements.findByAssetId).toHaveBeenCalledWith(record.assetId);
    });

    // The scanner never judged the file: every attempt failed to answer and
    // the budget ran out. Answering a re-send with this import would leave
    // the export unimportable for good.
    it('lets a file the scanner never judged be sent again', async () => {
      const record = importOf(
        {},
        {
          state: FileAssetState.REJECTED,
          rejectionCode: SCAN_NOT_COMPLETED,
        },
      );
      placements.findByAssetId.mockResolvedValue(
        placementOf(record, FileAssetPlacementState.REJECTED),
      );

      await expect(service.mayBeReplaced(record)).resolves.toBe(true);
    });

    it.each([
      ['refused on what was in it', FileAssetState.REJECTED, 'INFECTED'],
      ['refused for its rows', FileAssetState.REJECTED, 'ROWS_UNREADABLE'],
    ])('keeps an import %s as the answer', async (_how, state, code) => {
      const record = importOf({}, { state, rejectionCode: code });
      placements.findByAssetId.mockResolvedValue(
        placementOf(record, FileAssetPlacementState.REJECTED),
      );

      await expect(service.mayBeReplaced(record)).resolves.toBe(false);
    });

    it('keeps an import in force as the answer', async () => {
      const record = importOf();
      placements.findByAssetId.mockResolvedValue(
        placementOf(record, FileAssetPlacementState.ACTIVE),
      );

      await expect(service.mayBeReplaced(record)).resolves.toBe(false);
    });
  });

  describe('summary', () => {
    it('reports the file, the counts, the reading and who sent it', async () => {
      await expect(service.summary(FLEET_ID, 'import-1')).resolves.toEqual({
        id: 'import-1',
        assetId: 'asset-of-import-1',
        fleetId: FLEET_ID,
        originalFilename: 'Fixture Basic Fleet_20240101-120000.Csv',
        sourceSha256: 'a'.repeat(64),
        sanitisedSha256: 'b'.repeat(64),
        sourceByteSize: 4096,
        sanitisedByteSize: 2048,
        sourceHeaderShape: RosterSourceHeaderShape.OFFICER,
        exportTimezone: 'Europe/London',
        exportLocalStamp: '2024-01-01T12:00:00',
        exportedAt: EXPORTED_AT,
        exportedAtAmbiguous: false,
        rowCount: 93,
        officerTailRowCount: 7,
        parserVersion: 1,
        state: FileAssetState.QUARANTINED,
        retainUntil: RETAIN_UNTIL,
        conflictGroupId: null,
        status: RosterImportStatus.SCANNING,
        statusReason: null,
        problemCount: 0,
        uploadedByName: 'kmarr',
        uploadedAt: UPLOADED_AT,
        excluded: false,
        partial: false,
      });
    });

    // FC-019: whoever can read an import can see whether it still counts.
    it('says whether an investigator excluded it or marked it partial', async () => {
      imports.findOne.mockResolvedValue(
        importOf({ excluded: true, partial: true }),
      );

      await expect(
        service.summary(FLEET_ID, 'import-1'),
      ).resolves.toMatchObject({ excluded: true, partial: true });
    });

    // Looked up within the Fleet, so an import of another Fleet is absent
    // rather than forbidden and a probe learns nothing from the difference.
    it('looks the import up within its Fleet', async () => {
      await service.summary(FLEET_ID, 'import-1');

      expect(imports.findOne).toHaveBeenCalledWith({
        where: { id: 'import-1', fleetId: FLEET_ID },
        relations: RELATIONS,
      });
    });

    it('reports an import the Fleet does not have as not found', async () => {
      imports.findOne.mockResolvedValue(null);

      await expect(
        service.summary(FLEET_ID, 'import-9'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('names nobody once the uploader has gone', async () => {
      imports.findOne.mockResolvedValue(importOf({ uploadedBy: null }));

      await expect(service.summary(FLEET_ID, 'import-1')).resolves.toEqual(
        expect.objectContaining({ uploadedByName: null }),
      );
    });

    it('names nobody when the uploader has no profile', async () => {
      imports.findOne.mockResolvedValue(
        importOf({ uploadedBy: {} as UserEntity }),
      );

      await expect(service.summary(FLEET_ID, 'import-1')).resolves.toEqual(
        expect.objectContaining({ uploadedByName: null }),
      );
    });

    it('counts the row problems without naming them', async () => {
      imports.findOne.mockResolvedValue(
        importOf({
          publicationProblems: [
            {
              code: RosterRowRejectionCode.LEVEL_MALFORMED,
              line: 4,
              column: 'Level',
            },
            {
              code: RosterRowRejectionCode.LEVEL_MALFORMED,
              line: 9,
              column: 'Level',
            },
          ],
        }),
      );

      const summary = await service.summary(FLEET_ID, 'import-1');

      expect(summary.problemCount).toBe(2);
      expect(summary).not.toHaveProperty('problems');
    });
  });

  describe('where an import has got to', () => {
    it.each([
      FileAssetState.RECEIVING,
      FileAssetState.QUARANTINED,
      FileAssetState.SCANNING,
      FileAssetState.RETRY_PENDING,
    ])('is SCANNING while its asset is %s', async state => {
      await expect(
        report(importOf({}, { state }), FileAssetPlacementState.PENDING),
      ).resolves.toEqual({
        status: RosterImportStatus.SCANNING,
        statusReason: null,
      });
    });

    // A placement lost at ingress does not stop the scanner answering.
    it('is SCANNING before it has claimed a placement', async () => {
      await expect(report(importOf(), null)).resolves.toEqual({
        status: RosterImportStatus.SCANNING,
        statusReason: null,
      });
    });

    it.each([FileAssetState.CLEAN, FileAssetState.AVAILABLE])(
      'is PUBLISHING once cleared (%s) and still pending',
      async state => {
        await expect(
          report(importOf({}, { state }), FileAssetPlacementState.PENDING),
        ).resolves.toEqual({
          status: RosterImportStatus.PUBLISHING,
          statusReason: null,
        });
      },
    );

    it('is IMPORTED once in force', async () => {
      await expect(
        report(
          importOf({}, { state: FileAssetState.AVAILABLE }),
          FileAssetPlacementState.ACTIVE,
        ),
      ).resolves.toEqual({
        status: RosterImportStatus.IMPORTED,
        statusReason: null,
      });
    });

    // Retention destroys the file and not the observations read from it.
    it('stays IMPORTED once its file has been destroyed', async () => {
      await expect(
        report(
          importOf({}, { state: FileAssetState.DELETED }),
          FileAssetPlacementState.ACTIVE,
        ),
      ).resolves.toEqual(
        expect.objectContaining({ status: RosterImportStatus.IMPORTED }),
      );
    });

    it('is HELD, and says why, when another export disagrees', async () => {
      await expect(
        report(
          importOf(
            { conflictGroupId: 'group-1' },
            { state: FileAssetState.CLEAN },
          ),
          FileAssetPlacementState.HELD,
        ),
      ).resolves.toEqual({
        status: RosterImportStatus.HELD,
        statusReason: 'EXPORT_INSTANT_IN_CONFLICT',
      });
    });

    it('does not claim a conflict for a hold with no conflict group', async () => {
      await expect(
        report(
          importOf({}, { state: FileAssetState.CLEAN }),
          FileAssetPlacementState.HELD,
        ),
      ).resolves.toEqual({
        status: RosterImportStatus.HELD,
        statusReason: null,
      });
    });

    it('is ABANDONED when nothing ever came back for it', async () => {
      await expect(
        report(
          importOf({}, { state: FileAssetState.DELETED }),
          FileAssetPlacementState.ABANDONED,
        ),
      ).resolves.toEqual({
        status: RosterImportStatus.ABANDONED,
        statusReason: null,
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it('is EXPIRED when its file went while it was held (FC-037)', async () => {
      await expect(
        report(
          importOf({}, { state: FileAssetState.DELETED }),
          FileAssetPlacementState.WITHDRAWN,
        ),
      ).resolves.toEqual({
        status: RosterImportStatus.EXPIRED,
        statusReason: null,
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it('is ERASED when an erasure deleted its file while it was held (FC-038)', async () => {
      await expect(
        report(
          importOf(
            {},
            {
              state: FileAssetState.DELETED,
              revocationReason: ROSTER_SOURCE_ERASED_REASON,
            },
          ),
          FileAssetPlacementState.WITHDRAWN,
        ),
      ).resolves.toEqual({
        status: RosterImportStatus.ERASED,
        statusReason: null,
      });
    });

    it('stays IMPORTED when the file of an import in force expires (FC-037)', async () => {
      await expect(
        report(
          importOf({}, { state: FileAssetState.DELETED }),
          FileAssetPlacementState.ACTIVE,
        ),
      ).resolves.toEqual({
        status: RosterImportStatus.IMPORTED,
        statusReason: null,
      });
    });

    it.each([
      'ROWS_UNREADABLE',
      'EXPORT_TIMEZONE_MISSING',
      'NOT_THIS_IMPORT',
      SCAN_NOT_COMPLETED,
    ])(
      'names a refusal that says nothing about the content (%s)',
      async rejectionCode => {
        await expect(
          report(
            importOf({}, { state: FileAssetState.REJECTED, rejectionCode }),
            FileAssetPlacementState.REJECTED,
          ),
        ).resolves.toEqual({
          status: RosterImportStatus.REFUSED,
          statusReason: rejectionCode,
        });
      },
    );

    // R24: naming what matched tells a prober what gets through.
    it.each(['INFECTED', 'ENCRYPTED', 'SCAN_BUDGET_EXHAUSTED', null])(
      'hides whatever else refused it (%s)',
      async rejectionCode => {
        await expect(
          report(
            importOf({}, { state: FileAssetState.REJECTED, rejectionCode }),
            FileAssetPlacementState.REJECTED,
          ),
        ).resolves.toEqual({
          status: RosterImportStatus.REFUSED,
          statusReason: SCAN_REFUSED,
        });
      },
    );

    describe('in a state nothing writes', () => {
      it.each([
        ['a cleared file with no placement', FileAssetState.CLEAN, null],
        [
          'a pending import whose file is gone',
          FileAssetState.DELETED,
          FileAssetPlacementState.PENDING,
        ],
        [
          'a superseded placement',
          FileAssetState.CLEAN,
          FileAssetPlacementState.SUPERSEDED,
        ],
      ] as const)(
        'reports %s as ABANDONED',
        async (_name, state, placement) => {
          await expect(
            report(importOf({}, { state }), placement),
          ).resolves.toEqual({
            status: RosterImportStatus.ABANDONED,
            statusReason: null,
          });
        },
      );

      it('says so in the log', async () => {
        await report(importOf({}, { state: FileAssetState.CLEAN }), null);

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(
            'ImportId: import-1, AssetState: CLEAN, PlacementState: none',
          ),
        );
      });
    });
  });

  describe('detail', () => {
    const problems = [
      {
        code: RosterRowRejectionCode.LEVEL_MALFORMED,
        line: 4,
        column: 'Level',
      },
      { code: RosterRowRejectionCode.DATE_MALFORMED, line: 9, column: null },
    ];

    it('shows an importer neither the rows nor the other exports', async () => {
      imports.findOne.mockResolvedValue(
        importOf({ publicationProblems: problems, conflictGroupId: 'group-1' }),
      );

      await expect(
        service.detail(FLEET_ID, 'import-1', false),
      ).resolves.toEqual(
        expect.objectContaining({
          problemCount: 2,
          problems: null,
          conflictMembers: null,
          selectedImportId: null,
          excludedLines: null,
          actions: null,
        }),
      );
      expect(imports.find).not.toHaveBeenCalled();
      expect(observations.find).not.toHaveBeenCalled();
      expect(actions.find).not.toHaveBeenCalled();
      expect(conflicts.findOne).not.toHaveBeenCalled();
    });

    it('shows an investigator every row problem as a line, a column and a code', async () => {
      imports.findOne.mockResolvedValue(
        importOf({
          publicationProblems: problems.map(problem => ({
            ...problem,
            // Whatever else was stored beside a problem stays there.
            extra: 'not for the response',
          })),
        }),
      );

      const detail = await service.detail(FLEET_ID, 'import-1', true);

      expect(detail.problems).toEqual(problems);
    });

    it('shows an investigator an empty list when nothing was wrong', async () => {
      const detail = await service.detail(FLEET_ID, 'import-1', true);

      expect(detail.problems).toEqual([]);
      expect(detail.conflictMembers).toEqual([]);
      expect(detail.selectedImportId).toBeNull();
      expect(detail.excludedLines).toEqual([]);
      expect(detail.actions).toEqual([]);
      expect(imports.find).not.toHaveBeenCalled();
      expect(conflicts.findOne).not.toHaveBeenCalled();
    });

    it('shows an investigator the lines of the rows excluded, in order', async () => {
      observations.find.mockResolvedValue([{ line: 4 }, { line: 9 }]);

      const detail = await service.detail(FLEET_ID, 'import-1', true);

      expect(observations.find).toHaveBeenCalledWith({
        where: { importSourceId: 'import-1', excluded: true },
        select: { line: true },
        order: { line: 'ASC' },
      });
      expect(detail.excludedLines).toEqual([4, 9]);
    });

    it('shows an investigator every correction, newest first, by username', async () => {
      const actedAt = new Date('2024-12-01T09:00:00Z');

      actions.find.mockResolvedValue([
        {
          id: 'action-2',
          action: RosterImportActionKind.ROWS_EXCLUDED,
          actor: { profile: { username: 'odo' } },
          reason: 'Duplicated rows',
          detail: { lines: [4, 9] },
          actedAt,
        },
        {
          id: 'action-1',
          action: RosterImportActionKind.MARKED_PARTIAL,
          actor: null,
          reason: 'Cut off',
          detail: null,
          actedAt,
        },
      ]);

      const detail = await service.detail(FLEET_ID, 'import-1', true);

      expect(actions.find).toHaveBeenCalledWith({
        where: { importSourceId: 'import-1' },
        relations: { actor: { profile: true } },
        order: { actedAt: 'DESC', id: 'DESC' },
      });
      expect(detail.actions).toEqual([
        {
          id: 'action-2',
          action: RosterImportActionKind.ROWS_EXCLUDED,
          actorName: 'odo',
          reason: 'Duplicated rows',
          detail: { lines: [4, 9] },
          actedAt,
        },
        {
          id: 'action-1',
          action: RosterImportActionKind.MARKED_PARTIAL,
          actorName: null,
          reason: 'Cut off',
          detail: null,
          actedAt,
        },
      ]);
    });

    it('names nobody for a correction whose investigator has no profile', async () => {
      actions.find.mockResolvedValue([
        {
          id: 'action-1',
          action: RosterImportActionKind.EXCLUDED,
          actor: {},
          reason: 'Wrong Fleet',
          detail: null,
          actedAt: new Date(),
        },
      ]);

      const detail = await service.detail(FLEET_ID, 'import-1', true);

      expect(detail.actions![0].actorName).toBeNull();
    });

    it.each([
      [
        'its group selected an export',
        { selectedImportId: 'import-3' },
        'import-3',
      ],
      ['nobody has selected one', { selectedImportId: null }, null],
      ['its group cannot be found', null, null],
    ])(
      'shows an investigator the selection when %s',
      async (_case, group, expected) => {
        imports.findOne.mockResolvedValue(
          importOf({ conflictGroupId: 'group-1' }),
        );
        conflicts.findOne.mockResolvedValue(group);

        const detail = await service.detail(FLEET_ID, 'import-1', true);

        expect(conflicts.findOne).toHaveBeenCalledWith({
          where: { id: 'group-1' },
          select: { id: true, selectedImportId: true },
        });
        expect(detail.selectedImportId).toBe(expected);
      },
    );

    it('shows an investigator the other exports of the moment, oldest first', async () => {
      const record = importOf({ id: 'import-2', conflictGroupId: 'group-1' });
      const earlier = importOf({ id: 'import-1', conflictGroupId: 'group-1' });

      imports.findOne.mockResolvedValue(record);
      imports.find.mockResolvedValue([earlier]);
      placements.findByAssetIds.mockImplementation(assetIds =>
        Promise.resolve(
          (assetIds as string[]).includes(earlier.assetId)
            ? [placementOf(earlier, FileAssetPlacementState.ACTIVE)]
            : [placementOf(record, FileAssetPlacementState.HELD)],
        ),
      );

      const detail = await service.detail(FLEET_ID, 'import-2', true);

      expect(imports.find).toHaveBeenCalledWith({
        where: {
          fleetId: FLEET_ID,
          conflictGroupId: 'group-1',
          id: Not('import-2'),
        },
        relations: RELATIONS,
        order: { uploadedAt: 'ASC', id: 'ASC' },
      });
      expect(detail.status).toBe(RosterImportStatus.HELD);
      expect(
        detail.conflictMembers?.map(member => [member.id, member.status]),
      ).toEqual([['import-1', RosterImportStatus.IMPORTED]]);
    });

    it('reports an import the Fleet does not have as not found', async () => {
      imports.findOne.mockResolvedValue(null);

      await expect(
        service.detail(FLEET_ID, 'import-9', true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
  describe('rows', () => {
    const row = {
      id: 'observation-1',
      line: 2,
      characterName: 'Tova Reen',
      accountHandle: '@fixture004',
      guildRank: 'Member',
      level: 65,
      contributionTotal: '98300',
      joinedAt: EXPORTED_AT,
      lastActiveAt: null,
      excluded: true,
    };

    /** One query the fake builder was asked for: each call, in order. */
    let calls: [string, unknown[]][];

    /**
     * The text arguments of a builder's calls, joined, so a test can ask what
     * a query filtered and ordered on.
     *
     * @returns The text.
     */
    const sqlOf = (): string =>
      calls
        .flatMap(([, args]) => args.filter(arg => typeof arg === 'string'))
        .join('\n');

    /**
     * The parameters a query was given, merged across every call that set
     * some.
     *
     * @returns The parameters.
     */
    const parametersOf = (): Record<string, unknown> =>
      Object.assign(
        {},
        ...calls.flatMap(([, args]) =>
          args.filter(arg => typeof arg === 'object' && arg !== null),
        ),
      );

    /**
     * The order the query asked for: each orderBy and addOrderBy, in turn.
     *
     * @returns Each column with its direction.
     */
    const orderOf = (): unknown[][] =>
      calls
        .filter(([step]) => step === 'orderBy' || step === 'addOrderBy')
        .map(([, args]) => args);

    beforeEach(() => {
      calls = [];
      observations.createQueryBuilder = jest.fn(() => {
        const chain: Record<string, (...args: unknown[]) => unknown> = {};

        for (const step of [
          'leftJoin',
          'where',
          'andWhere',
          'orderBy',
          'addOrderBy',
          'skip',
          'take',
          'select',
          'addSelect',
          'groupBy',
        ]) {
          chain[step] = (...args: unknown[]) => {
            calls.push([step, args]);

            return chain;
          };
        }
        chain.getManyAndCount = () => Promise.resolve([[row], 93]);
        chain.getRawMany = () =>
          Promise.resolve([
            { label: 'Member', members: '80' },
            { label: 'Captain', members: '13' },
          ]);

        return chain;
      });
      observations.manager = {
        find: jest.fn(() =>
          Promise.resolve([{ fleetId: FLEET_ID, label: 'Captain', tier: 1 }]),
        ),
      };
    });

    it('lists an import’s rows in line order, a page at a time, with its rank counts', async () => {
      await expect(
        service.rows(FLEET_ID, 'import-1', { page: 2, pageSize: 20 }),
      ).resolves.toEqual({
        items: [
          {
            line: 2,
            characterName: 'Tova Reen',
            accountHandle: '@fixture004',
            guildRank: 'Member',
            level: 65,
            contributionTotal: '98300',
            joinedAt: EXPORTED_AT,
            lastActiveAt: null,
            excluded: true,
          },
        ],
        ranks: [
          { label: 'Captain', tier: 1, members: 13 },
          { label: 'Member', tier: null, members: 80 },
        ],
        total: 93,
        page: 2,
        pageSize: 20,
      });
      expect(parametersOf()).toMatchObject({ importId: 'import-1' });
      expect(orderOf()).toEqual([['o.line', 'ASC', 'NULLS LAST']]);
      expect(calls).toContainEqual(['skip', [20]]);
      expect(calls).toContainEqual(['take', [20]]);
      expect(sqlOf()).not.toContain(':search');
      expect(sqlOf()).not.toContain(':rank');
    });

    it('lists the rows in line order when nothing is asked', async () => {
      await service.rows(FLEET_ID, 'import-1');

      expect(orderOf()).toEqual([['o.line', 'ASC', 'NULLS LAST']]);
    });

    // FC-055: found and ordered as the roster page is, ending on line.
    it('finds rows by part of a name or handle, narrowed to a rank', async () => {
      await service.rows(FLEET_ID, 'import-1', {
        search: 'Tova R',
        rank: 'Member',
      });

      expect(sqlOf()).toContain(
        '(o.characterNameNormalised LIKE :search OR o.accountHandleNormalised LIKE :search)',
      );
      expect(sqlOf()).toContain('o.guildRank = :rank');
      expect(parametersOf()).toMatchObject({
        search: '%tova r%',
        rank: 'Member',
      });
    });

    it('orders by a column, ending on line, and by rank through the rank order', async () => {
      await service.rows(FLEET_ID, 'import-1', {
        sort: RosterImportRowSort.LEVEL,
        direction: RosterSortDirection.DESC,
      });

      expect(orderOf()).toEqual([
        ['o.level', 'DESC', 'NULLS LAST'],
        ['o.line', 'ASC'],
      ]);

      calls = [];
      await service.rows(FLEET_ID, 'import-1', {
        sort: RosterImportRowSort.RANK,
      });

      expect(sqlOf()).toContain(
        'r.fleetId = o.fleetId AND r.label = o.guildRank',
      );
      expect(orderOf()).toEqual([
        ['r.tier', 'ASC', 'NULLS LAST'],
        ['o.guildRank', 'ASC'],
        ['o.line', 'ASC'],
      ]);
    });

    it('reports an import of another Fleet as absent', async () => {
      imports.findOne.mockResolvedValue(null);

      await expect(service.rows(FLEET_ID, 'import-9')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(observations.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('conflicts', () => {
    const OPENED_AT = new Date('2026-09-24T21:00:00.000Z');
    const group = (id: string, resolvedAt: Date | null) =>
      ({
        id,
        fleetId: FLEET_ID,
        exportedAt: EXPORTED_AT,
        openedAt: OPENED_AT,
        resolvedAt,
        selectedImportId: resolvedAt === null ? null : 'import-a',
      }) as RosterImportConflictEntity;

    it('lists the open groups by default, latest moment first, each with its exports', async () => {
      conflicts.findAndCount.mockResolvedValue([
        [group('group-1', null), group('group-2', null)],
        2,
      ]);
      imports.find.mockResolvedValue([
        importOf({ id: 'import-a', conflictGroupId: 'group-1' }),
        importOf({ id: 'import-b', conflictGroupId: 'group-1' }),
        importOf({ id: 'import-c', conflictGroupId: 'group-2' }),
      ]);

      const page = await service.conflicts(FLEET_ID);

      const [{ where, order }] = conflicts.findAndCount.mock.calls[0] as [
        { where: Record<string, unknown>; order: Record<string, string> },
      ];

      expect(where.fleetId).toBe(FLEET_ID);
      expect((where.resolvedAt as FindOperator<unknown>).type).toBe('isNull');
      expect(order).toEqual({ exportedAt: 'DESC', id: 'DESC' });
      expect(imports.find).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: RELATIONS,
          order: { uploadedAt: 'ASC', id: 'ASC' },
        }),
      );
      expect(page).toMatchObject({ total: 2, page: 1 });
      expect(page.items[0]).toMatchObject({
        id: 'group-1',
        exportedAt: EXPORTED_AT,
        openedAt: OPENED_AT,
        resolvedAt: null,
        selectedImportId: null,
      });
      expect(page.items[0].members.map(member => member.id)).toEqual([
        'import-a',
        'import-b',
      ]);
      expect(page.items[1].members.map(member => member.id)).toEqual([
        'import-c',
      ]);
    });

    it('lists the settled groups when asked', async () => {
      await service.conflicts(FLEET_ID, RosterImportConflictFilter.SETTLED);

      const [{ where }] = conflicts.findAndCount.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];

      const settled = where.resolvedAt as FindOperator<FindOperator<unknown>>;

      expect(settled.type).toBe('not');
      expect(settled.child?.type).toBe('isNull');
    });

    it('lists every group when asked, and reads no exports for none', async () => {
      const page = await service.conflicts(
        FLEET_ID,
        RosterImportConflictFilter.ALL,
        3,
        10,
      );

      expect(conflicts.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fleetId: FLEET_ID },
          skip: 20,
          take: 10,
        }),
      );
      expect(page.items).toEqual([]);
      expect(imports.find).not.toHaveBeenCalled();
    });
  });
});
