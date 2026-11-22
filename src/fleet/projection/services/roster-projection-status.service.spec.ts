import { Repository } from 'typeorm';

import { RosterProjectionInputEntity } from '../entities/roster-projection-input.entity';
import { RosterProjectionEntity } from '../entities/roster-projection.entity';
import { RosterProjectionInputOutcome } from '../enums/roster-projection-input-outcome.enum';
import { RosterProjectionStatusService } from './roster-projection-status.service';

const FLEET_ID = 'fleet-1';
const PUBLISHED_AT = new Date('2026-09-25T00:30:00Z');

describe('RosterProjectionStatusService', () => {
  let projections: { findOne: jest.Mock };
  let inputs: { find: jest.Mock };
  let service: RosterProjectionStatusService;

  beforeEach(() => {
    projections = {
      findOne: jest.fn(() =>
        Promise.resolve({
          fleetId: FLEET_ID,
          requested: 5,
          built: 5,
          revision: 4,
          publishedAt: PUBLISHED_AT,
          latestImportId: 'import-2',
        }),
      ),
    };
    inputs = {
      find: jest.fn(() =>
        Promise.resolve([
          {
            importSourceId: 'import-1',
            importSource: { originalFilename: 'Fleet_20241101-120000.Csv' },
            exportedAt: new Date('2024-11-01T12:00:00Z'),
            outcome: RosterProjectionInputOutcome.EXCLUDED,
            partial: false,
            excludedRows: 0,
          },
          {
            importSourceId: 'import-2',
            importSource: { originalFilename: 'Fleet_20241115-120000.Csv' },
            exportedAt: new Date('2024-11-15T12:00:00Z'),
            outcome: RosterProjectionInputOutcome.EFFECTIVE,
            partial: true,
            excludedRows: 2,
          },
        ]),
      ),
    };
    service = new RosterProjectionStatusService(
      projections as unknown as Repository<RosterProjectionEntity>,
      inputs as unknown as Repository<RosterProjectionInputEntity>,
    );
  });

  it('reports the published revision and every import it considered', async () => {
    await expect(service.status(FLEET_ID)).resolves.toEqual({
      revision: 4,
      publishedAt: PUBLISHED_AT,
      stale: false,
      latestImportId: 'import-2',
      inputs: [
        {
          importId: 'import-1',
          originalFilename: 'Fleet_20241101-120000.Csv',
          exportedAt: new Date('2024-11-01T12:00:00Z'),
          outcome: RosterProjectionInputOutcome.EXCLUDED,
          partial: false,
          excludedRows: 0,
        },
        {
          importId: 'import-2',
          originalFilename: 'Fleet_20241115-120000.Csv',
          exportedAt: new Date('2024-11-15T12:00:00Z'),
          outcome: RosterProjectionInputOutcome.EFFECTIVE,
          partial: true,
          excludedRows: 2,
        },
      ],
    });
  });

  // Pinned to the revision read first, so the two reads are one revision
  // even if a replay publishes the next between them.
  it('reads only the inputs of the revision it read, in export order', async () => {
    await service.status(FLEET_ID);

    expect(projections.findOne).toHaveBeenCalledWith({
      where: { fleetId: FLEET_ID },
    });
    expect(inputs.find).toHaveBeenCalledWith({
      where: { fleetId: FLEET_ID, revision: 4 },
      relations: { importSource: true },
      order: { exportedAt: 'ASC', importSource: { uploadedAt: 'ASC' } },
    });
  });

  it('says it is stale when a change has been made since it was built', async () => {
    projections.findOne.mockResolvedValue({
      fleetId: FLEET_ID,
      requested: 6,
      built: 5,
      revision: 4,
      publishedAt: PUBLISHED_AT,
      latestImportId: 'import-2',
    });

    await expect(service.status(FLEET_ID)).resolves.toMatchObject({
      revision: 4,
      stale: true,
    });
  });

  it('reports nothing built for a Fleet nothing has asked about', async () => {
    projections.findOne.mockResolvedValue(null);

    await expect(service.status(FLEET_ID)).resolves.toEqual({
      revision: 0,
      publishedAt: null,
      stale: false,
      latestImportId: null,
      inputs: [],
    });
    expect(inputs.find).not.toHaveBeenCalled();
  });

  it('reports a first revision asked for and not yet built as stale', async () => {
    projections.findOne.mockResolvedValue({
      fleetId: FLEET_ID,
      requested: 1,
      built: 0,
      revision: 0,
      publishedAt: null,
      latestImportId: null,
    });

    await expect(service.status(FLEET_ID)).resolves.toMatchObject({
      revision: 0,
      stale: true,
      inputs: [],
    });
  });
});
