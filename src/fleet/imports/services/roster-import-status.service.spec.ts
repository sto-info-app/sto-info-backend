import { Logger, NotFoundException } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Not, Repository } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetPlacementService } from 'src/file-assets/services/file-asset-placement.service';
import { UserEntity } from 'src/user/entities/user.entity';

import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterImportStatus } from '../enums/roster-import-status.enum';
import { RosterRowRejectionCode } from '../enums/roster-row-rejection-code.enum';
import { RosterSourceHeaderShape } from '../enums/roster-source-header-shape.enum';
import {
  RosterImportStatusService,
  SCAN_REFUSED,
} from './roster-import-status.service';

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
    };

    service = new RosterImportStatusService(
      imports as unknown as Repository<RosterImportSourceEntity>,
      placements as unknown as FileAssetPlacementService,
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
      });
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

    it.each(['ROWS_UNREADABLE', 'EXPORT_TIMEZONE_MISSING', 'NOT_THIS_IMPORT'])(
      'names a refusal this feature made (%s)',
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
        }),
      );
      expect(imports.find).not.toHaveBeenCalled();
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
      expect(imports.find).not.toHaveBeenCalled();
    });

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
});
