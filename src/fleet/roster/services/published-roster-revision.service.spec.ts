import { Repository } from 'typeorm';

import { RosterProjectionInputEntity } from '../../projection/entities/roster-projection-input.entity';
import { RosterProjectionEntity } from '../../projection/entities/roster-projection.entity';
import { RosterProjectionInputOutcome } from '../../projection/enums/roster-projection-input-outcome.enum';
import { PublishedRosterRevisionService } from './published-roster-revision.service';

const FLEET_ID = 'fleet-1';
const PUBLISHED_AT = new Date('2026-09-25T00:30:00Z');

describe('PublishedRosterRevisionService', () => {
  let projections: { findOne: jest.Mock };
  let inputs: { find: jest.Mock };
  let service: PublishedRosterRevisionService;

  beforeEach(() => {
    projections = {
      findOne: jest.fn(() =>
        Promise.resolve({
          fleetId: FLEET_ID,
          revision: 4,
          publishedAt: PUBLISHED_AT,
          requested: 5,
          built: 5,
        }),
      ),
    };
    inputs = {
      find: jest.fn(() =>
        Promise.resolve([
          {
            importSourceId: 'import-1',
            exportedAt: new Date('2024-11-01T12:00:00Z'),
            partial: false,
          },
          {
            importSourceId: 'import-2',
            exportedAt: new Date('2024-11-15T12:00:00Z'),
            partial: true,
          },
        ]),
      ),
    };
    service = new PublishedRosterRevisionService(
      projections as unknown as Repository<RosterProjectionEntity>,
      inputs as unknown as Repository<RosterProjectionInputEntity>,
    );
  });

  describe('pin', () => {
    it('reads the published revision', async () => {
      await expect(service.pin(FLEET_ID)).resolves.toEqual({
        revision: 4,
        publishedAt: PUBLISHED_AT,
        stale: false,
      });
      expect(projections.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fleetId: FLEET_ID } }),
      );
    });

    it('says a revision is stale while a change waits for the next', async () => {
      projections.findOne.mockResolvedValue({
        fleetId: FLEET_ID,
        revision: 4,
        publishedAt: PUBLISHED_AT,
        requested: 6,
        built: 5,
      });

      await expect(service.pin(FLEET_ID)).resolves.toMatchObject({
        stale: true,
      });
    });

    it('reads a Fleet never replayed as revision 0', async () => {
      projections.findOne.mockResolvedValue(null);

      await expect(service.pin(FLEET_ID)).resolves.toEqual({
        revision: 0,
        publishedAt: null,
        stale: false,
      });
    });
  });

  describe('effectiveExports', () => {
    it('lists the exports one revision read, oldest first', async () => {
      await expect(service.effectiveExports(FLEET_ID, 4)).resolves.toEqual([
        {
          importId: 'import-1',
          exportedAt: new Date('2024-11-01T12:00:00Z'),
          partial: false,
        },
        {
          importId: 'import-2',
          exportedAt: new Date('2024-11-15T12:00:00Z'),
          partial: true,
        },
      ]);
      expect(inputs.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            fleetId: FLEET_ID,
            revision: 4,
            outcome: RosterProjectionInputOutcome.EFFECTIVE,
          },
          order: { exportedAt: 'ASC' },
        }),
      );
    });

    it('lists none for revision 0 without asking', async () => {
      await expect(service.effectiveExports(FLEET_ID, 0)).resolves.toEqual([]);
      expect(inputs.find).not.toHaveBeenCalled();
    });
  });
});
