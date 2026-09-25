import { NotFoundException } from '@nestjs/common';

import { Repository } from 'typeorm';

import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { RosterChangeEntity } from '../../projection/entities/roster-change.entity';
import { RosterEpisodeEntity } from '../../projection/entities/roster-episode.entity';
import { RosterChangeKind } from '../../projection/enums/roster-change-kind.enum';
import { RosterEpisodeEnd } from '../../projection/enums/roster-episode-end.enum';
import { RosterEpisodeStart } from '../../projection/enums/roster-episode-start.enum';
import { RosterRankMove } from '../enums/roster-rank-move.enum';
import { PublishedRosterRevisionService } from './published-roster-revision.service';
import { RosterProfileLinkService } from './roster-profile-link.service';
import { RosterRankOrderService } from './roster-rank-order.service';
import { RosterTimelineService } from './roster-timeline.service';

const FLEET_ID = 'fleet-1';
const IDENTITY_ID = 'identity-1';
const PUBLISHED_AT = new Date('2026-09-25T00:30:00Z');
const NOV_1 = new Date('2024-11-01T12:00:00Z');
const NOV_15 = new Date('2024-11-15T12:00:00Z');
const DEC_1 = new Date('2024-12-01T12:00:00Z');

const READER = { userId: 'viewer-1', investigator: false };
const INVESTIGATOR = { userId: 'viewer-1', investigator: true };

const LINK = {
  username: 'tova',
  accountSlug: 'fixture004',
  characterSlug: 'tova-reen@fixture004',
};

/**
 * Builds one of the member's rows.
 *
 * @param importSourceId - The export.
 * @param overrides - Fields to change.
 * @returns The row.
 */
function observation(
  importSourceId: string,
  overrides: Partial<RosterObservationEntity> = {},
): RosterObservationEntity {
  return {
    importSourceId,
    line: 3,
    characterName: 'Tova Reen',
    accountHandle: '@fixture004',
    level: 65,
    guildRank: 'Member',
    contributionTotal: '98100',
    lastActiveAt: new Date('2024-10-30T20:00:00Z'),
    lastActiveAtAmbiguous: false,
    excluded: false,
    ...overrides,
  } as RosterObservationEntity;
}

describe('RosterTimelineService', () => {
  let revisions: { pin: jest.Mock; effectiveExports: jest.Mock };
  let episodes: { find: jest.Mock };
  let changes: { find: jest.Mock };
  let builder: Record<string, jest.Mock>;
  let observations: { createQueryBuilder: jest.Mock };
  let rankOrder: { tiers: jest.Mock };
  let profileLinks: { find: jest.Mock };
  let service: RosterTimelineService;

  beforeEach(() => {
    revisions = {
      pin: jest.fn(() =>
        Promise.resolve({
          revision: 4,
          publishedAt: PUBLISHED_AT,
          stale: false,
        }),
      ),
      effectiveExports: jest.fn(() =>
        Promise.resolve([
          { importId: 'import-1', exportedAt: NOV_1, partial: false },
          { importId: 'import-2', exportedAt: NOV_15, partial: true },
          { importId: 'import-3', exportedAt: DEC_1, partial: false },
        ]),
      ),
    };
    episodes = {
      find: jest.fn(() =>
        Promise.resolve([
          {
            ordinal: 1,
            startKind: RosterEpisodeStart.JOINED,
            startedAfterImportId: 'import-0',
            startedAfterAt: new Date('2024-10-27T01:30:00Z'),
            firstImportId: 'import-1',
            firstObservedAt: NOV_1,
            reportedJoinedAt: new Date('2024-10-28T09:00:00Z'),
            reportedJoinedAtAmbiguous: false,
            lastImportId: 'import-3',
            lastObservedAt: DEC_1,
            endKind: null,
            endedBefore: null,
            endedBeforeImportId: null,
            baselineContribution: '98000',
            lastObservedContribution: '98300',
          },
          {
            ordinal: 0,
            startKind: RosterEpisodeStart.FIRST_SEEN,
            startedAfterImportId: null,
            startedAfterAt: null,
            firstImportId: 'import-0',
            firstObservedAt: NOV_1,
            reportedJoinedAt: null,
            reportedJoinedAtAmbiguous: false,
            lastImportId: 'import-0',
            lastObservedAt: NOV_1,
            endKind: RosterEpisodeEnd.LEFT,
            endedBefore: NOV_15,
            endedBeforeImportId: 'import-2',
            baselineContribution: null,
            lastObservedContribution: null,
          },
        ] as unknown as RosterEpisodeEntity[]),
      ),
    };
    changes = {
      find: jest.fn(() =>
        Promise.resolve([
          {
            identityId: IDENTITY_ID,
            episodeOrdinal: 1,
            kind: RosterChangeKind.RANK_CHANGED,
            fromImportId: 'import-2',
            fromAt: NOV_15,
            toImportId: 'import-3',
            toAt: DEC_1,
            acrossGap: false,
            contributionDelta: null,
            detail: { fromRank: 'Member', toRank: 'Officer' },
          },
          {
            identityId: IDENTITY_ID,
            episodeOrdinal: 1,
            kind: RosterChangeKind.CONTRIBUTION_CHANGED,
            fromImportId: 'import-2',
            fromAt: NOV_15,
            toImportId: 'import-3',
            toAt: DEC_1,
            acrossGap: false,
            contributionDelta: '100',
            detail: { fromContribution: '98200', toContribution: '98300' },
          },
        ] as unknown as RosterChangeEntity[]),
      ),
    };
    builder = {};

    for (const method of ['innerJoin', 'where', 'andWhere']) {
      builder[method] = jest.fn(() => builder);
    }

    builder.getMany = jest.fn(() =>
      Promise.resolve([
        observation('import-3', {
          guildRank: 'Officer',
          contributionTotal: '98300',
        }),
        observation('import-1'),
        observation('import-2', { line: 7, contributionTotal: '98200' }),
      ]),
    );
    observations = { createQueryBuilder: jest.fn(() => builder) };
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
    profileLinks = {
      find: jest.fn(() =>
        Promise.resolve(new Map([['tova reen@fixture004', LINK]])),
      ),
    };
    service = new RosterTimelineService(
      revisions as unknown as PublishedRosterRevisionService,
      episodes as unknown as Repository<RosterEpisodeEntity>,
      changes as unknown as Repository<RosterChangeEntity>,
      observations as unknown as Repository<RosterObservationEntity>,
      rankOrder as unknown as RosterRankOrderService,
      profileLinks as unknown as RosterProfileLinkService,
    );
  });

  it('reads the member from the published revision, named as last listed', async () => {
    const timeline = await service.timeline(FLEET_ID, IDENTITY_ID, READER);

    expect(timeline).toMatchObject({
      revision: 4,
      publishedAt: PUBLISHED_AT,
      stale: false,
      identityId: IDENTITY_ID,
      member: { characterName: 'Tova Reen', accountHandle: '@fixture004' },
      profile: LINK,
    });
    expect(episodes.find).toHaveBeenCalledWith({
      where: { fleetId: FLEET_ID, revision: 4, identityId: IDENTITY_ID },
      order: { ordinal: 'ASC' },
    });
    expect(changes.find).toHaveBeenCalledWith({
      where: { fleetId: FLEET_ID, revision: 4, identityId: IDENTITY_ID },
      order: { toAt: 'ASC', episodeOrdinal: 'ASC' },
    });
  });

  it('links by the roster’s rule, from the latest export listing them', async () => {
    await service.timeline(FLEET_ID, IDENTITY_ID, READER);

    expect(profileLinks.find).toHaveBeenCalledWith(
      FLEET_ID,
      DEC_1,
      [expect.objectContaining({ importId: 'import-3' })],
      'viewer-1',
    );
  });

  it('leaves the member unlinked when the rule does not allow it', async () => {
    profileLinks.find.mockResolvedValue(new Map());

    const timeline = await service.timeline(FLEET_ID, IDENTITY_ID, READER);

    expect(timeline.profile).toBeNull();
  });

  it('lists their rows oldest first, with tiers and each export’s partial mark', async () => {
    const timeline = await service.timeline(FLEET_ID, IDENTITY_ID, READER);

    expect(timeline.rows).toEqual([
      {
        importId: 'import-1',
        exportedAt: NOV_1,
        partial: false,
        line: 3,
        characterName: 'Tova Reen',
        accountHandle: '@fixture004',
        level: 65,
        guildRank: 'Member',
        rankTier: 2,
        contributionTotal: '98100',
        lastActiveAt: new Date('2024-10-30T20:00:00Z'),
        lastActiveAtAmbiguous: false,
        excluded: false,
      },
      expect.objectContaining({ importId: 'import-2', partial: true }),
      expect.objectContaining({ importId: 'import-3', rankTier: 1 }),
    ]);
  });

  it('orders two rows on one export by line', async () => {
    builder.getMany.mockResolvedValue([
      observation('import-1', { line: 9, characterName: 'Tova Reen-Ashe' }),
      observation('import-1', { line: 3, guildRank: 'Cadet' }),
    ]);

    const timeline = await service.timeline(FLEET_ID, IDENTITY_ID, READER);

    expect(timeline.rows.map(row => [row.line, row.rankTier])).toEqual([
      [3, null],
      [9, 2],
    ]);
  });

  it('asks only for their rows on the revision’s effective exports', async () => {
    await service.timeline(FLEET_ID, IDENTITY_ID, READER);

    expect(revisions.effectiveExports).toHaveBeenCalledWith(FLEET_ID, 4);
    expect(builder.andWhere).toHaveBeenCalledWith(
      'a.identityId = :identityId',
      { identityId: IDENTITY_ID },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'o.importSourceId IN (:...importIds)',
      { importIds: ['import-1', 'import-2', 'import-3'] },
    );
    expect(builder.andWhere).toHaveBeenCalledWith('o.excluded = false');
  });

  it('shows an investigator the rows an investigator excluded', async () => {
    await service.timeline(FLEET_ID, IDENTITY_ID, INVESTIGATOR);

    expect(builder.andWhere).not.toHaveBeenCalledWith('o.excluded = false');
  });

  it('carries every change, contribution included, with rank moves', async () => {
    const timeline = await service.timeline(FLEET_ID, IDENTITY_ID, READER);

    expect(timeline.changes).toEqual([
      expect.objectContaining({
        kind: RosterChangeKind.RANK_CHANGED,
        rankMove: RosterRankMove.PROMOTED,
        member: null,
      }),
      expect.objectContaining({
        kind: RosterChangeKind.CONTRIBUTION_CHANGED,
        contributionDelta: '100',
        fromContribution: '98200',
        toContribution: '98300',
      }),
    ]);
  });

  it('carries each episode’s bounds', async () => {
    const timeline = await service.timeline(FLEET_ID, IDENTITY_ID, READER);

    expect(timeline.episodes).toEqual([
      {
        ordinal: 1,
        startKind: RosterEpisodeStart.JOINED,
        startedAfter: {
          importId: 'import-0',
          exportedAt: new Date('2024-10-27T01:30:00Z'),
        },
        first: { importId: 'import-1', exportedAt: NOV_1 },
        reportedJoinedAt: new Date('2024-10-28T09:00:00Z'),
        reportedJoinedAtAmbiguous: false,
        last: { importId: 'import-3', exportedAt: DEC_1 },
        endKind: null,
        endedBefore: null,
        endedBeforeImportId: null,
        baselineContribution: '98000',
        lastObservedContribution: '98300',
      },
      expect.objectContaining({
        ordinal: 0,
        startedAfter: null,
        endKind: RosterEpisodeEnd.LEFT,
        endedBefore: NOV_15,
        endedBeforeImportId: 'import-2',
      }),
    ]);
  });

  it('reads a member with episodes and no rows the reader may see, unnamed', async () => {
    builder.getMany.mockResolvedValue([]);

    const timeline = await service.timeline(FLEET_ID, IDENTITY_ID, READER);

    expect(timeline).toMatchObject({ member: null, profile: null, rows: [] });
    expect(profileLinks.find).not.toHaveBeenCalled();
  });

  it('refuses a member the revision has nothing of, as not found', async () => {
    episodes.find.mockResolvedValue([]);
    builder.getMany.mockResolvedValue([]);

    await expect(
      service.timeline(FLEET_ID, IDENTITY_ID, READER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(changes.find).not.toHaveBeenCalled();
  });

  it('refuses anyone for a Fleet with no effective export', async () => {
    revisions.pin.mockResolvedValue({
      revision: 0,
      publishedAt: null,
      stale: false,
    });
    revisions.effectiveExports.mockResolvedValue([]);
    episodes.find.mockResolvedValue([]);

    await expect(
      service.timeline(FLEET_ID, IDENTITY_ID, READER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(observations.createQueryBuilder).not.toHaveBeenCalled();
  });
});
