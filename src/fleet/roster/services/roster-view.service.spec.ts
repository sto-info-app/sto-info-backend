import { Repository } from 'typeorm';

import { RosterIdentityAliasEntity } from '../../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { RosterProfession } from '../../imports/enums/roster-profession.enum';
import { RosterQueryDto } from '../dto/roster-query.dto';
import { RosterRankOrderEntity } from '../entities/roster-rank-order.entity';
import { RosterSort, RosterSortDirection } from '../enums/roster-sort.enum';
import {
  EffectiveRosterExport,
  PublishedRosterRevisionService,
} from './published-roster-revision.service';
import { RosterProfileLinkService } from './roster-profile-link.service';
import { ROSTER_PAGE_SIZE, RosterViewService } from './roster-view.service';

const FLEET_ID = 'fleet-1';
const PUBLISHED_AT = new Date('2026-09-25T00:30:00Z');

const EXPORTS: EffectiveRosterExport[] = [
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
  {
    importId: 'import-3',
    exportedAt: new Date('2024-12-01T12:00:00Z'),
    partial: false,
  },
];

const READER = { userId: 'viewer-1', investigator: false };
const INVESTIGATOR = { userId: 'viewer-1', investigator: true };

/**
 * Builds an export row as the service reads one.
 *
 * @param overrides - Fields to change.
 * @returns The row.
 */
function row(
  overrides: Partial<RosterObservationEntity> = {},
): RosterObservationEntity {
  return {
    line: 2,
    characterName: 'Vex Loran',
    characterNameNormalised: 'vex loran',
    accountHandle: '@VexLoran',
    accountHandleNormalised: '@vexloran',
    level: 65,
    className: 'Tactical Officer',
    profession: RosterProfession.TACTICAL,
    guildRank: 'Officer',
    contributionTotal: '125000',
    joinedAt: new Date('2023-01-01T10:00:00Z'),
    joinedAtAmbiguous: false,
    rankChangedAt: null,
    rankChangedAtAmbiguous: false,
    lastActiveAt: new Date('2024-11-30T20:00:00Z'),
    lastActiveAtAmbiguous: false,
    status: 'Online',
    publicComment: 'Hello',
    publicCommentEditedAt: null,
    excluded: false,
    ...overrides,
  } as RosterObservationEntity;
}

/** A chainable query-builder double recording what it was asked. */
interface QueryBuilderDouble {
  where: jest.Mock;
  andWhere: jest.Mock;
  leftJoin: jest.Mock;
  innerJoin: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  groupBy: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  offset: jest.Mock;
  limit: jest.Mock;
  getManyAndCount: jest.Mock;
  getRawMany: jest.Mock;
}

/**
 * Builds a query-builder double.
 *
 * @returns The double, every chainable method returning it.
 */
function queryBuilder(): QueryBuilderDouble {
  const builder = {} as QueryBuilderDouble;

  for (const method of [
    'where',
    'andWhere',
    'leftJoin',
    'innerJoin',
    'select',
    'addSelect',
    'groupBy',
    'orderBy',
    'addOrderBy',
    'offset',
    'limit',
  ] as const) {
    builder[method] = jest.fn(() => builder);
  }

  builder.getManyAndCount = jest.fn(() => Promise.resolve([[], 0]));
  builder.getRawMany = jest.fn(() => Promise.resolve([]));

  return builder;
}

describe('RosterViewService', () => {
  let revisions: { pin: jest.Mock; effectiveExports: jest.Mock };
  let builders: QueryBuilderDouble[];
  let observations: { createQueryBuilder: jest.Mock };
  let aliases: { find: jest.Mock };
  let rankOrder: { find: jest.Mock };
  let profileLinks: { find: jest.Mock };
  let service: RosterViewService;

  /** The rows query, the rank counts and the identity counts, in order. */
  const rowsQuery = (): QueryBuilderDouble => builders[0];
  const ranksQuery = (): QueryBuilderDouble => builders[1];
  const identityQuery = (): QueryBuilderDouble => builders[2];

  /**
   * Sets what the three queries answer.
   *
   * @param rows - The page's rows, and the total behind them.
   * @param ranks - The rank counts.
   * @param identityRows - The identity row counts.
   */
  function answer(
    rows: [RosterObservationEntity[], number],
    ranks: Array<{ label: string; members: string }> = [],
    identityRows: Array<{ identityId: string; rows: string }> = [],
  ): void {
    const results = [rows, ranks, identityRows];

    observations.createQueryBuilder.mockImplementation(() => {
      const builder = queryBuilder();
      const result = results[builders.length];

      builder.getManyAndCount.mockResolvedValue(result);
      builder.getRawMany.mockResolvedValue(result);
      builders.push(builder);

      return builder;
    });
  }

  beforeEach(() => {
    builders = [];
    revisions = {
      pin: jest.fn(() =>
        Promise.resolve({
          revision: 4,
          publishedAt: PUBLISHED_AT,
          stale: false,
        }),
      ),
      effectiveExports: jest.fn(() => Promise.resolve(EXPORTS)),
    };
    observations = { createQueryBuilder: jest.fn() };
    aliases = {
      find: jest.fn(() =>
        Promise.resolve([
          {
            identityId: 'identity-1',
            characterNameNormalised: 'vex loran',
            accountHandleNormalised: '@vexloran',
          },
        ]),
      ),
    };
    rankOrder = {
      find: jest.fn(() =>
        Promise.resolve([
          { fleetId: FLEET_ID, label: 'Officer', tier: 1 },
          { fleetId: FLEET_ID, label: 'Member', tier: 2 },
        ]),
      ),
    };
    profileLinks = { find: jest.fn(() => Promise.resolve(new Map())) };
    answer([[row()], 1]);

    service = new RosterViewService(
      revisions as unknown as PublishedRosterRevisionService,
      observations as unknown as Repository<RosterObservationEntity>,
      aliases as unknown as Repository<RosterIdentityAliasEntity>,
      rankOrder as unknown as Repository<RosterRankOrderEntity>,
      profileLinks as unknown as RosterProfileLinkService,
    );
  });

  describe('choosing the export', () => {
    it('shows the latest effective export, pinned to the published revision', async () => {
      const page = await service.page(FLEET_ID, {}, READER);

      expect(revisions.effectiveExports).toHaveBeenCalledWith(FLEET_ID, 4);
      expect(page).toMatchObject({
        revision: 4,
        publishedAt: PUBLISHED_AT,
        stale: false,
        coverage: {
          exports: 3,
          first: {
            importId: 'import-1',
            exportedAt: EXPORTS[0].exportedAt,
          },
          latest: {
            importId: 'import-3',
            exportedAt: EXPORTS[2].exportedAt,
          },
        },
        export: {
          importId: 'import-3',
          exportedAt: EXPORTS[2].exportedAt,
          partial: false,
          previous: {
            importId: 'import-2',
            exportedAt: EXPORTS[1].exportedAt,
          },
          next: null,
        },
      });
      expect(rowsQuery().where).toHaveBeenCalledWith(
        'o.importSourceId = :importId',
        { importId: 'import-3' },
      );
    });

    it('shows the last export at or before the instant asked for', async () => {
      const page = await service.page(
        FLEET_ID,
        { asOf: '2024-11-15T12:00:00.000Z' },
        READER,
      );

      expect(page.export).toEqual({
        importId: 'import-2',
        exportedAt: EXPORTS[1].exportedAt,
        partial: true,
        previous: { importId: 'import-1', exportedAt: EXPORTS[0].exportedAt },
        next: { importId: 'import-3', exportedAt: EXPORTS[2].exportedAt },
      });
    });

    it('shows the first export with nothing before it', async () => {
      const page = await service.page(
        FLEET_ID,
        { asOf: '2024-11-02T00:00:00Z' },
        READER,
      );

      expect(page.export).toMatchObject({
        importId: 'import-1',
        previous: null,
      });
    });

    it('shows no export before the first, with the coverage to step to it', async () => {
      const page = await service.page(
        FLEET_ID,
        { asOf: '2024-10-01T00:00:00Z' },
        READER,
      );

      expect(page).toMatchObject({
        export: null,
        items: [],
        ranks: [],
        total: 0,
        coverage: { exports: 3, first: { importId: 'import-1' } },
      });
      expect(observations.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('shows nothing for a Fleet with no published revision', async () => {
      revisions.pin.mockResolvedValue({
        revision: 0,
        publishedAt: null,
        stale: true,
      });
      revisions.effectiveExports.mockResolvedValue([]);

      await expect(service.page(FLEET_ID, {}, READER)).resolves.toEqual({
        revision: 0,
        publishedAt: null,
        stale: true,
        coverage: { exports: 0, first: null, latest: null },
        export: null,
        ranks: [],
        items: [],
        total: 0,
        page: 1,
        pageSize: ROSTER_PAGE_SIZE,
      });
    });
  });

  describe('the rows', () => {
    it('maps each row with its member, tier and link', async () => {
      const link = {
        username: 'vex',
        accountSlug: 'VexLoran',
        characterSlug: 'vex-loran@vexloran',
      };

      answer([[row()], 1], [], [{ identityId: 'identity-1', rows: '1' }]);
      profileLinks.find.mockResolvedValue(
        new Map([['vex loran@vexloran', link]]),
      );

      const page = await service.page(FLEET_ID, {}, READER);

      expect(page.items).toEqual([
        {
          line: 2,
          identityId: 'identity-1',
          identityRows: 1,
          characterName: 'Vex Loran',
          accountHandle: '@VexLoran',
          level: 65,
          className: 'Tactical Officer',
          profession: RosterProfession.TACTICAL,
          guildRank: 'Officer',
          rankTier: 1,
          contributionTotal: '125000',
          joinedAt: new Date('2023-01-01T10:00:00Z'),
          joinedAtAmbiguous: false,
          rankChangedAt: null,
          rankChangedAtAmbiguous: false,
          lastActiveAt: new Date('2024-11-30T20:00:00Z'),
          lastActiveAtAmbiguous: false,
          status: 'Online',
          publicComment: 'Hello',
          publicCommentEditedAt: null,
          excluded: false,
          profile: link,
        },
      ]);
      expect(page.total).toBe(1);
      expect(profileLinks.find).toHaveBeenCalledWith(
        FLEET_ID,
        EXPORTS[2].exportedAt,
        [row()],
        'viewer-1',
      );
      expect(aliases.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            {
              fleetId: FLEET_ID,
              characterNameNormalised: 'vex loran',
              accountHandleNormalised: '@vexloran',
            },
          ],
        }),
      );
    });

    it('keeps two rows of one member apart, saying how many there are', async () => {
      const renamed = row({
        line: 3,
        characterName: 'Vex Loran-Ashe',
        characterNameNormalised: 'vex loran-ashe',
        guildRank: 'Recruit',
      });

      answer(
        [[row(), renamed], 2],
        [],
        [{ identityId: 'identity-1', rows: '2' }],
      );
      aliases.find.mockResolvedValue([
        {
          identityId: 'identity-1',
          characterNameNormalised: 'vex loran',
          accountHandleNormalised: '@vexloran',
        },
        {
          identityId: 'identity-1',
          characterNameNormalised: 'vex loran-ashe',
          accountHandleNormalised: '@vexloran',
        },
      ]);

      const page = await service.page(FLEET_ID, {}, READER);

      expect(
        page.items.map(item => [item.line, item.identityId, item.identityRows]),
      ).toEqual([
        [2, 'identity-1', 2],
        [3, 'identity-1', 2],
      ]);
      expect(page.items[1].rankTier).toBeNull();
      expect(identityQuery().andWhere).toHaveBeenCalledWith(
        'a.identityId IN (:...identityIds)',
        { identityIds: ['identity-1'] },
      );
    });

    it('reads a row with no member found as one of its own', async () => {
      aliases.find.mockResolvedValue([]);

      const page = await service.page(FLEET_ID, {}, READER);

      expect(page.items[0]).toMatchObject({
        identityId: null,
        identityRows: 1,
        profile: null,
      });
      expect(builders).toHaveLength(2);
    });

    it('reads a member the count missed as one row', async () => {
      const page = await service.page(FLEET_ID, {}, READER);

      expect(page.items[0].identityRows).toBe(1);
    });

    it('asks nothing more for an empty page', async () => {
      answer([[], 0]);

      const page = await service.page(FLEET_ID, { page: 9 }, READER);

      expect(page.items).toEqual([]);
      expect(aliases.find).not.toHaveBeenCalled();
      expect(profileLinks.find).not.toHaveBeenCalled();
    });

    it('pages 50 at a time unless asked otherwise', async () => {
      await service.page(FLEET_ID, {}, READER);

      expect(rowsQuery().offset).toHaveBeenCalledWith(0);
      expect(rowsQuery().limit).toHaveBeenCalledWith(50);
    });

    it('pages as asked', async () => {
      const page = await service.page(
        FLEET_ID,
        { page: 3, pageSize: 20 },
        READER,
      );

      expect(rowsQuery().offset).toHaveBeenCalledWith(40);
      expect(rowsQuery().limit).toHaveBeenCalledWith(20);
      expect(page).toMatchObject({ page: 3, pageSize: 20 });
    });
  });

  describe('excluded rows', () => {
    it('hides them from a reader in every query', async () => {
      answer([[row()], 1], [], [{ identityId: 'identity-1', rows: '1' }]);

      await service.page(FLEET_ID, {}, READER);

      for (const builder of builders) {
        expect(builder.andWhere).toHaveBeenCalledWith('o.excluded = false');
      }

      expect(builders).toHaveLength(3);
    });

    it('shows them to an investigator, marked', async () => {
      answer([[row({ excluded: true })], 1]);

      const page = await service.page(FLEET_ID, {}, INVESTIGATOR);

      for (const builder of builders) {
        expect(builder.andWhere).not.toHaveBeenCalledWith('o.excluded = false');
      }

      expect(page.items[0].excluded).toBe(true);
    });
  });

  describe('filtering', () => {
    it('matches a name or handle, folded and with wildcards taken literally', async () => {
      await service.page(FLEET_ID, { search: 'VEX_100%' }, READER);

      expect(rowsQuery().andWhere).toHaveBeenCalledWith(
        '(o.characterNameNormalised LIKE :search OR o.accountHandleNormalised LIKE :search)',
        { search: '%vex\\_100\\%%' },
      );
    });

    it('filters by exact rank label', async () => {
      await service.page(FLEET_ID, { rank: 'Officer' }, READER);

      expect(rowsQuery().andWhere).toHaveBeenCalledWith('o.guildRank = :rank', {
        rank: 'Officer',
      });
    });

    it('filters nothing unless asked', async () => {
      await service.page(FLEET_ID, {}, READER);

      expect(rowsQuery().andWhere).toHaveBeenCalledTimes(1);
    });
  });

  describe('ordering', () => {
    it('orders by name by default, ending on handle and line', async () => {
      await service.page(FLEET_ID, {}, READER);

      expect(rowsQuery().leftJoin).toHaveBeenCalledWith(
        RosterRankOrderEntity,
        'r',
        'r.fleetId = o.fleetId AND r.label = o.guildRank',
      );
      expect(rowsQuery().orderBy).toHaveBeenCalledWith(
        'o.characterNameNormalised',
        RosterSortDirection.ASC,
        'NULLS LAST',
      );
      expect(rowsQuery().addOrderBy.mock.calls).toEqual([
        ['o.characterNameNormalised', 'ASC'],
        ['o.accountHandleNormalised', 'ASC'],
        ['o.line', 'ASC'],
      ]);
    });

    it.each([
      [RosterSort.HANDLE, 'o.accountHandleNormalised'],
      [RosterSort.LEVEL, 'o.level'],
      [RosterSort.JOINED, 'o.joinedAt'],
      [RosterSort.CONTRIBUTION, 'o.contributionTotal'],
      [RosterSort.LAST_ACTIVE, 'o.lastActiveAt'],
    ])('orders by %s', async (sort, column) => {
      await service.page(
        FLEET_ID,
        { sort, direction: RosterSortDirection.DESC },
        READER,
      );

      expect(rowsQuery().orderBy).toHaveBeenCalledWith(
        column,
        RosterSortDirection.DESC,
        'NULLS LAST',
      );
      expect(rowsQuery().addOrderBy).toHaveBeenCalledTimes(3);
    });

    it('orders by tier and then label, unplaced labels last', async () => {
      const query: RosterQueryDto = {
        sort: RosterSort.RANK,
        direction: RosterSortDirection.DESC,
      };

      await service.page(FLEET_ID, query, READER);

      expect(rowsQuery().orderBy).toHaveBeenCalledWith(
        'r.tier',
        RosterSortDirection.DESC,
        'NULLS LAST',
      );
      expect(rowsQuery().addOrderBy.mock.calls[0]).toEqual([
        'o.guildRank',
        RosterSortDirection.DESC,
      ]);
    });
  });

  describe('rank counts', () => {
    it('counts each label, highest tier first and unplaced labels by name last', async () => {
      answer(
        [[row()], 1],
        [
          { label: 'Recruit', members: '5' },
          { label: 'Member', members: '20' },
          { label: 'Cadet', members: '2' },
          { label: 'Officer', members: '1' },
        ],
      );

      const page = await service.page(FLEET_ID, {}, READER);

      expect(page.ranks).toEqual([
        { label: 'Officer', tier: 1, members: 1 },
        { label: 'Member', tier: 2, members: 20 },
        { label: 'Cadet', tier: null, members: 2 },
        { label: 'Recruit', tier: null, members: 5 },
      ]);
      expect(ranksQuery().groupBy).toHaveBeenCalledWith('o.guildRank');
      expect(rankOrder.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fleetId: FLEET_ID } }),
      );
    });
  });
});
