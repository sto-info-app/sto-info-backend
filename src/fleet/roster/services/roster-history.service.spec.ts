import { FindOperator, Repository } from 'typeorm';

import { RosterChangeEntity } from '../../projection/entities/roster-change.entity';
import { RosterIntervalSummaryEntity } from '../../projection/entities/roster-interval-summary.entity';
import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';
import { ROSTER_HISTORY_KINDS } from '../dto/roster-history-query.dto';
import { RosterRankMove } from '../enums/roster-rank-move.enum';
import { PublishedRosterRevisionService } from './published-roster-revision.service';
import { RosterHistoryService } from './roster-history.service';
import { RosterMemberNameService } from './roster-member-name.service';
import { RosterRankOrderService } from './roster-rank-order.service';

const FLEET_ID = 'fleet-1';
const PUBLISHED_AT = new Date('2026-09-25T00:30:00Z');
const NOV_1 = new Date('2024-11-01T12:00:00Z');
const NOV_15 = new Date('2024-11-15T12:00:00Z');
const DEC_1 = new Date('2024-12-01T12:00:00Z');

/**
 * Builds an interval summary.
 *
 * @param from - The earlier export and its instant.
 * @param to - The later export and its instant.
 * @returns The summary.
 */
function interval(
  from: [string, Date],
  to: [string, Date],
): RosterIntervalSummaryEntity {
  return {
    fleetId: FLEET_ID,
    revision: 4,
    fromImportId: from[0],
    fromAt: from[1],
    toImportId: to[0],
    toAt: to[1],
    partial: false,
    membersAtStart: 6,
    membersAtEnd: 6,
    joined: 1,
    rejoined: 0,
    left: 1,
    unknown: 0,
    renamed: 1,
    rankChanged: 1,
    joinDateChanged: 0,
    acrossGap: 0,
    contributionDelta: '1700',
    contributionKnown: 4,
    contributionReset: 0,
    contributionBaseline: 1,
    contributionUnknown: 1,
  } as RosterIntervalSummaryEntity;
}

/**
 * Builds a stored change.
 *
 * @param kind - What changed.
 * @param identityId - The member.
 * @param overrides - Fields to change.
 * @returns The change.
 */
function change(
  kind: RosterChangeKind,
  identityId: string,
  overrides: Partial<RosterChangeEntity> = {},
): RosterChangeEntity {
  return {
    identityId,
    episodeOrdinal: 1,
    kind,
    fromImportId: 'import-1',
    fromAt: NOV_1,
    toImportId: 'import-2',
    toAt: NOV_15,
    acrossGap: false,
    contributionDelta: null,
    detail: {},
    ...overrides,
  } as RosterChangeEntity;
}

describe('RosterHistoryService', () => {
  let revisions: { pin: jest.Mock };
  let intervals: { findAndCount: jest.Mock };
  let changes: { find: jest.Mock };
  let names: { names: jest.Mock };
  let rankOrder: { tiers: jest.Mock };
  let service: RosterHistoryService;

  beforeEach(() => {
    revisions = {
      pin: jest.fn(() =>
        Promise.resolve({
          revision: 4,
          publishedAt: PUBLISHED_AT,
          stale: false,
        }),
      ),
    };
    intervals = {
      findAndCount: jest.fn(() =>
        Promise.resolve([
          [
            interval(['import-2', NOV_15], ['import-3', DEC_1]),
            interval(['import-1', NOV_1], ['import-2', NOV_15]),
          ],
          5,
        ]),
      ),
    };
    changes = {
      find: jest.fn(() =>
        Promise.resolve([
          change(RosterChangeKind.RANK_CHANGED, 'identity-tova', {
            detail: { fromRank: 'Member', toRank: 'Officer' },
          }),
          change(RosterChangeKind.LEFT, 'identity-kess'),
          change(RosterChangeKind.JOINED, 'identity-zara', {
            detail: { baselineContribution: '5200' },
          }),
          change(RosterChangeKind.JOINED, 'identity-aria', {
            detail: { baselineContribution: '0' },
          }),
        ]),
      ),
    };
    names = {
      names: jest.fn(() =>
        Promise.resolve(
          new Map([
            [
              'import-2/identity-tova',
              { characterName: 'Tova Reen', accountHandle: '@fixture004' },
            ],
            [
              'import-1/identity-kess',
              { characterName: 'Kess Varro', accountHandle: '@fixture030' },
            ],
            [
              'import-2/identity-zara',
              { characterName: 'Zara Quell', accountHandle: '@fixture050' },
            ],
            [
              'import-2/identity-aria',
              { characterName: 'Aria Venn', accountHandle: '@fixture001' },
            ],
          ]),
        ),
      ),
    };
    rankOrder = {
      tiers: jest.fn(() =>
        Promise.resolve(
          new Map([
            ['Officer', 1],
            ['Member', 2],
          ]),
        ),
      ),
    };
    service = new RosterHistoryService(
      revisions as unknown as PublishedRosterRevisionService,
      intervals as unknown as Repository<RosterIntervalSummaryEntity>,
      changes as unknown as Repository<RosterChangeEntity>,
      names as unknown as RosterMemberNameService,
      rankOrder as unknown as RosterRankOrderService,
    );
  });

  it('reads the newest intervals of the published revision, ten to a page', async () => {
    const page = await service.page(FLEET_ID, {});

    expect(intervals.findAndCount).toHaveBeenCalledWith({
      where: { fleetId: FLEET_ID, revision: 4 },
      order: { toAt: 'DESC' },
      skip: 0,
      take: 10,
    });
    expect(page).toMatchObject({
      revision: 4,
      publishedAt: PUBLISHED_AT,
      stale: false,
      total: 5,
      page: 1,
      pageSize: 10,
    });
    expect(page.items.map(item => item.to.importId)).toEqual([
      'import-3',
      'import-2',
    ]);
  });

  it('carries each interval’s summary', async () => {
    const [latest] = (await service.page(FLEET_ID, {})).items;

    expect(latest).toEqual({
      from: { importId: 'import-2', exportedAt: NOV_15 },
      to: { importId: 'import-3', exportedAt: DEC_1 },
      partial: false,
      membersAtStart: 6,
      membersAtEnd: 6,
      joined: 1,
      rejoined: 0,
      left: 1,
      unknown: 0,
      renamed: 1,
      rankChanged: 1,
      joinDateChanged: 0,
      acrossGap: 0,
      contributionDelta: '1700',
      contributionKnown: 4,
      contributionReset: 0,
      contributionBaseline: 1,
      contributionUnknown: 1,
      changes: [],
    });
  });

  it('lists the changes each later export revealed, by kind and then name', async () => {
    const page = await service.page(FLEET_ID, {});
    const listed = page.items[1].changes;

    expect(
      listed.map(item => [
        item.kind,
        item.member?.characterName,
        item.rankMove,
      ]),
    ).toEqual([
      [RosterChangeKind.JOINED, 'Aria Venn', null],
      [RosterChangeKind.JOINED, 'Zara Quell', null],
      [RosterChangeKind.LEFT, 'Kess Varro', null],
      [RosterChangeKind.RANK_CHANGED, 'Tova Reen', RosterRankMove.PROMOTED],
    ]);
    // Contribution is shown as totals only.
    expect(listed[0]).not.toHaveProperty('baselineContribution');
  });

  it('names a departure from the export that last listed them', async () => {
    await service.page(FLEET_ID, {});

    expect(names.names).toHaveBeenCalledWith(FLEET_ID, [
      { importId: 'import-2', identityId: 'identity-tova' },
      { importId: 'import-1', identityId: 'identity-kess' },
      { importId: 'import-2', identityId: 'identity-zara' },
      { importId: 'import-2', identityId: 'identity-aria' },
    ]);
  });

  it('names a departure no export bounds below from the export that found it', async () => {
    changes.find.mockResolvedValue([
      change(RosterChangeKind.LEFT, 'identity-kess', {
        fromImportId: null,
        fromAt: null,
      }),
    ]);

    await service.page(FLEET_ID, {});

    expect(names.names).toHaveBeenCalledWith(FLEET_ID, [
      { importId: 'import-2', identityId: 'identity-kess' },
    ]);
  });

  it('orders unnamed members of one kind by identity', async () => {
    changes.find.mockResolvedValue([
      change(RosterChangeKind.JOINED, 'identity-b'),
      change(RosterChangeKind.JOINED, 'identity-a'),
    ]);
    names.names.mockResolvedValue(new Map());

    const listed = (await service.page(FLEET_ID, {})).items[1].changes;

    expect(listed.map(item => [item.identityId, item.member])).toEqual([
      ['identity-a', null],
      ['identity-b', null],
    ]);
  });

  it('asks only for the page’s intervals and the listed kinds', async () => {
    await service.page(FLEET_ID, {});

    const [{ where }] = changes.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];

    expect(where).toMatchObject({ fleetId: FLEET_ID, revision: 4 });
    expect((where.toImportId as FindOperator<string[]>).value).toEqual([
      'import-3',
      'import-2',
    ]);
    expect((where.kind as FindOperator<string[]>).value).toEqual([
      ...ROSTER_HISTORY_KINDS,
    ]);
    expect(ROSTER_HISTORY_KINDS).not.toContain(
      RosterChangeKind.CONTRIBUTION_CHANGED,
    );
    expect(ROSTER_HISTORY_KINDS).not.toContain(
      RosterChangeKind.CONTRIBUTION_RESET,
    );
  });

  it('asks only for the kinds a reader filtered to, on the page asked for', async () => {
    await service.page(FLEET_ID, {
      page: 2,
      pageSize: 3,
      kinds: [RosterChangeKind.LEFT],
    });

    expect(intervals.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 3, take: 3 }),
    );

    const [{ where }] = changes.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];

    expect((where.kind as FindOperator<string[]>).value).toEqual([
      RosterChangeKind.LEFT,
    ]);
  });

  it('asks nothing more for a page past the last', async () => {
    intervals.findAndCount.mockResolvedValue([[], 5]);

    await expect(service.page(FLEET_ID, { page: 9 })).resolves.toMatchObject({
      items: [],
      total: 5,
      page: 9,
    });
    expect(changes.find).not.toHaveBeenCalled();
  });

  it('reads nothing for a Fleet with no published revision', async () => {
    revisions.pin.mockResolvedValue({
      revision: 0,
      publishedAt: null,
      stale: true,
    });

    await expect(service.page(FLEET_ID, {})).resolves.toEqual({
      revision: 0,
      publishedAt: null,
      stale: true,
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
    expect(intervals.findAndCount).not.toHaveBeenCalled();
  });
});
