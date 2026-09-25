import { DataSource } from 'typeorm';

import { RosterIdentityAliasEntity } from '../../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { RosterProjectionInputEntity } from '../../projection/entities/roster-projection-input.entity';
import { RosterActivityBand } from '../enums/roster-activity-band.enum';
import { FleetReportQueryService } from './fleet-report-query.service';

/** A chainable query-builder double. */
type Builder = Record<string, jest.Mock>;

/**
 * Builds a query-builder double answering with some rows.
 *
 * @param rows - What its terminal read gives.
 * @returns The double.
 */
function builder(rows: unknown[] = []): Builder {
  const double: Builder = {};

  for (const method of [
    'select',
    'addSelect',
    'from',
    'innerJoin',
    'where',
    'andWhere',
    'groupBy',
    'addGroupBy',
    'setParameters',
  ]) {
    double[method] = jest.fn(() => double);
  }

  double.getRawMany = jest.fn(() => Promise.resolve(rows));
  double.getQuery = jest.fn(() => 'SELECT inner');
  double.getParameters = jest.fn(() => ({ fleetId: 'fleet-1' }));

  return double;
}

describe('FleetReportQueryService', () => {
  let builders: Builder[];
  let dataSource: { createQueryBuilder: jest.Mock };
  let service: FleetReportQueryService;

  /**
   * Queues the builders the service will be handed, in order.
   *
   * @param queued - The builders.
   */
  function hand(...queued: Builder[]): void {
    builders = queued;
    dataSource.createQueryBuilder.mockImplementation(() => builders.shift());
  }

  beforeEach(() => {
    dataSource = { createQueryBuilder: jest.fn() };
    service = new FleetReportQueryService(dataSource as unknown as DataSource);
  });

  describe('accounts', () => {
    it('counts the distinct handles on each export, excluded rows aside', async () => {
      const query = builder([
        { importId: 'import-1', count: '6' },
        { importId: 'import-2', count: '2' },
      ]);

      hand(query);

      await expect(service.accounts(['import-1', 'import-2'])).resolves.toEqual(
        [
          { importId: 'import-1', count: 6 },
          { importId: 'import-2', count: 2 },
        ],
      );
      expect(query.addSelect).toHaveBeenCalledWith(
        'COUNT(DISTINCT o.accountHandleNormalised)',
        'count',
      );
      expect(query.from).toHaveBeenCalledWith(RosterObservationEntity, 'o');
      expect(query.andWhere).toHaveBeenCalledWith('o.excluded = false');
      expect(query.groupBy).toHaveBeenCalledWith('o.importSourceId');
    });

    it('asks nothing for no exports', async () => {
      await expect(service.accounts([])).resolves.toEqual([]);
      expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('activity', () => {
    it('counts each export’s members by band, from one row per member', async () => {
      const members = builder();
      const counts = builder([
        {
          importId: 'import-1',
          band: RosterActivityBand.WITHIN_7_DAYS,
          count: '21',
        },
        { importId: 'import-1', band: RosterActivityBand.UNKNOWN, count: '2' },
      ]);

      hand(members, counts);

      await expect(
        service.activity('fleet-1', 4, ['import-1']),
      ).resolves.toEqual([
        {
          importId: 'import-1',
          band: RosterActivityBand.WITHIN_7_DAYS,
          count: 21,
        },
        { importId: 'import-1', band: RosterActivityBand.UNKNOWN, count: 2 },
      ]);

      expect(dataSource.createQueryBuilder).toHaveBeenCalledWith(
        RosterProjectionInputEntity,
        'i',
      );
      expect(members.innerJoin).toHaveBeenCalledWith(
        RosterObservationEntity,
        'o',
        'o.importSourceId = i.importSourceId AND o.excluded = false',
      );
      expect(members.innerJoin).toHaveBeenCalledWith(
        RosterIdentityAliasEntity,
        'a',
        expect.stringContaining(
          'a.accountHandleNormalised = o.accountHandleNormalised',
        ),
      );
      expect(members.andWhere).toHaveBeenCalledWith('i.revision = :revision', {
        revision: 4,
      });
      expect(members.addGroupBy).toHaveBeenCalledWith('a.identityId');
      expect(members.addSelect).toHaveBeenCalledWith(
        'MAX(o.lastActiveAt)',
        'lastActiveAt',
      );

      const [band] = counts.addSelect.mock.calls[0] as [string];

      for (const threshold of [
        "INTERVAL '7 days'",
        "INTERVAL '30 days'",
        "INTERVAL '90 days'",
      ]) {
        expect(band).toContain(threshold);
      }

      expect(band).toContain(`IS NULL THEN '${RosterActivityBand.UNKNOWN}'`);
      expect(counts.from).toHaveBeenCalledWith('(SELECT inner)', 'm');
      expect(counts.setParameters).toHaveBeenCalledWith({ fleetId: 'fleet-1' });
      expect(counts.addGroupBy).toHaveBeenCalledWith('2');
    });

    it('asks nothing for no exports', async () => {
      await expect(service.activity('fleet-1', 4, [])).resolves.toEqual([]);
      expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
