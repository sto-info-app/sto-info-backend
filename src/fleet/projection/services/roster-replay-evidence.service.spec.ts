import { EntityManager, EntityTarget, FindOperator } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';

import { RosterImportConflictEntity } from '../../imports/entities/roster-import-conflict.entity';
import { RosterImportSourceEntity } from '../../imports/entities/roster-import-source.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { RosterProjectionInputOutcome } from '../enums/roster-projection-input-outcome.enum';
import { RosterReplayEvidenceService } from './roster-replay-evidence.service';

const FLEET_ID = 'fleet-1';

type Row = Record<string, unknown>;

describe('RosterReplayEvidenceService', () => {
  let imports: Row[];
  let placements: Row[];
  let observations: Row[];
  let conflicts: Row[];
  let find: jest.Mock;
  let service: RosterReplayEvidenceService;

  const within = (condition: unknown, value: unknown): boolean =>
    condition instanceof FindOperator
      ? (condition.value as unknown[]).includes(value)
      : condition === value;

  const addImport = (
    id: string,
    exportedAt: string,
    state: FileAssetPlacementState | null,
    extra: Row = {},
  ): void => {
    imports.push({
      id,
      exportedAt: new Date(exportedAt),
      uploadedAt: new Date(`2024-12-0${imports.length + 1}T00:00:00Z`),
      sanitisedSha256: 'a'.repeat(64),
      excluded: false,
      partial: false,
      conflictGroupId: null,
      ...extra,
    });

    if (state !== null) {
      placements.push({
        subject: FileAssetSubject.ROSTER_IMPORT,
        subjectId: id,
        state,
      });
    }
  };

  const read = () =>
    service.read({ find } as unknown as EntityManager, FLEET_ID);

  beforeEach(() => {
    imports = [];
    placements = [];
    observations = [];
    conflicts = [];
    find = jest.fn((entity: EntityTarget<unknown>, options: Row) => {
      const where = options.where as Row;

      switch (entity) {
        case RosterImportSourceEntity:
          return Promise.resolve([...imports]);
        case FileAssetPlacementEntity:
          return Promise.resolve(
            placements.filter(
              each =>
                each.subject === where.subject &&
                within(where.subjectId, each.subjectId) &&
                within(where.state, each.state),
            ),
          );
        case RosterObservationEntity:
          return Promise.resolve(
            observations.filter(each =>
              where.excluded === true
                ? each.excluded === true && each.fleetId === where.fleetId
                : each.importSourceId === where.importSourceId,
            ),
          );
        case RosterImportConflictEntity:
          return Promise.resolve(
            conflicts.filter(each => within(where.id, each.id)),
          );
        default:
          throw new Error('Unexpected find');
      }
    });
    service = new RosterReplayEvidenceService();
  });

  it('reads nothing more of a Fleet with no import', async () => {
    await expect(read()).resolves.toEqual({ inputs: [], snapshots: [] });

    expect(find).toHaveBeenCalledTimes(1);
  });

  it('asks only for imports that claim an instant, and none of their text', async () => {
    await read();

    const [[, options]] = find.mock.calls as [[unknown, Row]];

    expect((options.where as Row).fleetId).toBe(FLEET_ID);
    expect((options.where as Row).exportedAt).toBeInstanceOf(FindOperator);
    expect(options.select).not.toHaveProperty('originalFilename');
  });

  it('considers only imports in force or held, and reads only the effective ones', async () => {
    addImport(
      'i-active',
      '2024-11-01T12:00:00Z',
      FileAssetPlacementState.ACTIVE,
    );
    addImport(
      'i-pending',
      '2024-11-02T12:00:00Z',
      FileAssetPlacementState.PENDING,
    );
    addImport(
      'i-refused',
      '2024-11-03T12:00:00Z',
      FileAssetPlacementState.REJECTED,
    );
    addImport('i-nothing', '2024-11-04T12:00:00Z', null);
    addImport('i-held', '2024-11-01T12:00:00Z', FileAssetPlacementState.HELD, {
      sanitisedSha256: 'b'.repeat(64),
      conflictGroupId: 'g',
    });
    conflicts.push({ id: 'g', selectedImportId: null });
    observations.push(
      { importSourceId: 'i-active', line: 2, characterName: 'Kira' },
      { importSourceId: 'i-held', line: 2, characterName: 'Odo' },
    );

    const evidence = await read();

    expect(evidence.inputs.map(each => [each.id, each.outcome])).toEqual([
      ['i-active', RosterProjectionInputOutcome.EFFECTIVE],
      ['i-held', RosterProjectionInputOutcome.AWAITING_SELECTION],
    ]);
    expect(evidence.inputs[1].inForce).toBe(false);
    expect(evidence.snapshots).toEqual([
      {
        importId: 'i-active',
        exportedAt: new Date('2024-11-01T12:00:00Z'),
        partial: false,
        rows: [{ importSourceId: 'i-active', line: 2, characterName: 'Kira' }],
      },
    ]);
  });

  it('reads rows in line order, with only the columns the replay uses', async () => {
    addImport('i1', '2024-11-01T12:00:00Z', FileAssetPlacementState.ACTIVE);

    await read();

    expect(find).toHaveBeenCalledWith(RosterObservationEntity, {
      where: { importSourceId: 'i1' },
      select: expect.objectContaining({ excluded: true, guildRank: true }),
      order: { line: 'ASC' },
    });

    const rowRead = find.mock.calls.find(
      ([entity, options]) =>
        entity === RosterObservationEntity &&
        (options as Row).order !== undefined,
    )!;

    for (const column of ['publicComment', 'status', 'lastActiveAt']) {
      expect((rowRead[1] as Row).select).not.toHaveProperty(column);
    }
  });

  it('counts each import’s excluded rows, and says whether it was marked partial', async () => {
    addImport('i1', '2024-11-01T12:00:00Z', FileAssetPlacementState.ACTIVE, {
      partial: true,
    });
    addImport('i2', '2024-11-15T12:00:00Z', FileAssetPlacementState.ACTIVE);
    observations.push(
      { fleetId: FLEET_ID, importSourceId: 'i2', excluded: true },
      { fleetId: FLEET_ID, importSourceId: 'i2', excluded: true },
    );

    const evidence = await read();

    expect(
      evidence.inputs.map(each => [each.id, each.partial, each.excludedRows]),
    ).toEqual([
      ['i1', true, 0],
      ['i2', false, 2],
    ]);
    expect(evidence.snapshots[0].partial).toBe(true);
  });

  it('reads the selections of the groups its imports are in', async () => {
    addImport('i1', '2024-11-01T12:00:00Z', FileAssetPlacementState.ACTIVE, {
      conflictGroupId: 'g',
    });
    addImport('i2', '2024-11-01T12:00:00Z', FileAssetPlacementState.ACTIVE, {
      conflictGroupId: 'g',
      sanitisedSha256: 'b'.repeat(64),
    });
    conflicts.push({ id: 'g', selectedImportId: 'i2' });

    const evidence = await read();

    expect(evidence.inputs.map(each => [each.id, each.outcome])).toEqual([
      ['i1', RosterProjectionInputOutcome.NOT_SELECTED],
      ['i2', RosterProjectionInputOutcome.EFFECTIVE],
    ]);
  });

  it('asks for no selection when no import is in a group', async () => {
    addImport('i1', '2024-11-01T12:00:00Z', FileAssetPlacementState.ACTIVE);

    await read();

    expect(find).not.toHaveBeenCalledWith(
      RosterImportConflictEntity,
      expect.anything(),
    );
  });
});
