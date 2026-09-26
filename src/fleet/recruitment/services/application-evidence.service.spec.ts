import { Repository } from 'typeorm';

import { RosterIdentityAliasEntity } from '../../identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { RosterEpisodeEntity } from '../../projection/entities/roster-episode.entity';
import { PublishedRosterRevisionService } from '../../roster/services/published-roster-revision.service';
import { ApplicationEvidenceService } from './application-evidence.service';

const FIRST_EXPORT = new Date('2026-09-01T12:00:00Z');
const LATEST_EXPORT = new Date('2026-09-20T12:00:00Z');
const EXPORTS = [
  { importId: 'import-1', exportedAt: FIRST_EXPORT, partial: false },
  { importId: 'import-2', exportedAt: LATEST_EXPORT, partial: false },
];

/** Kell Marr on the account kell, as registered on STO Info. */
const KELL = { handle: 'Kell Marr', fullHandleNormalized: 'kell marr@kell' };

describe('ApplicationEvidenceService', () => {
  let revision: number;
  let exports: typeof EXPORTS;
  let aliases: Partial<RosterIdentityAliasEntity>[];
  let episodes: Partial<RosterEpisodeEntity>[];
  let rows: Partial<RosterObservationEntity>[];
  let aliasFind: jest.Mock;
  let episodeFind: jest.Mock;
  let rowFind: jest.Mock;
  let service: ApplicationEvidenceService;

  beforeEach(() => {
    revision = 3;
    exports = EXPORTS;
    aliases = [
      {
        identityId: 'identity-1',
        characterName: 'Kell Marr',
        characterNameNormalised: 'kell marr',
        accountHandle: '@kell',
        accountHandleNormalised: '@kell',
      },
      // The same name on somebody else's account is somebody else.
      {
        identityId: 'identity-2',
        characterName: 'Kell Marr',
        characterNameNormalised: 'kell marr',
        accountHandle: '@other',
        accountHandleNormalised: '@other',
      },
    ];
    episodes = [
      {
        identityId: 'identity-1',
        firstObservedAt: FIRST_EXPORT,
        lastImportId: 'import-2',
      },
    ];
    rows = [
      {
        characterName: 'Kell Marr',
        accountHandle: '@other',
        guildRank: 'Recruit',
      },
      {
        characterName: 'Kell Marr',
        accountHandle: '@kell',
        guildRank: 'Officer',
      },
    ];
    aliasFind = jest.fn(() => Promise.resolve(aliases));
    episodeFind = jest.fn(() => Promise.resolve(episodes));
    rowFind = jest.fn(() => Promise.resolve(rows));
    service = new ApplicationEvidenceService(
      {
        pin: jest.fn(() => Promise.resolve({ revision })),
        effectiveExports: jest.fn(() => Promise.resolve(exports)),
      } as unknown as PublishedRosterRevisionService,
      { find: aliasFind } as unknown as Repository<RosterIdentityAliasEntity>,
      { find: episodeFind } as unknown as Repository<RosterEpisodeEntity>,
      { find: rowFind } as unknown as Repository<RosterObservationEntity>,
    );
  });

  it('says the latest export lists the Character, since when and at what rank', async () => {
    await expect(service.forCharacter('fleet-1', KELL)).resolves.toEqual({
      listed: true,
      latestExportAt: LATEST_EXPORT,
      listedSince: FIRST_EXPORT,
      rank: 'Officer',
      everListed: true,
    });
  });

  it('matches on the exact name and handle, as FC-018 does', async () => {
    await service.forCharacter('fleet-1', KELL);

    expect(aliasFind).toHaveBeenCalledWith({
      where: { fleetId: 'fleet-1', characterNameNormalised: 'kell marr' },
    });
    expect(episodeFind).toHaveBeenCalledWith({
      where: {
        fleetId: 'fleet-1',
        revision: 3,
        identityId: expect.objectContaining({ _value: ['identity-1'] }),
      },
    });
    expect(rowFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ importSourceId: 'import-2' }),
      }),
    );
  });

  it('says nothing is known of a name no export has listed', async () => {
    aliases = [];

    await expect(service.forCharacter('fleet-1', KELL)).resolves.toEqual({
      listed: false,
      latestExportAt: LATEST_EXPORT,
      listedSince: null,
      rank: null,
      everListed: false,
    });
    expect(episodeFind).not.toHaveBeenCalled();
  });

  it('says a Character was listed once but is not now', async () => {
    episodes = [
      {
        identityId: 'identity-1',
        firstObservedAt: FIRST_EXPORT,
        lastImportId: 'import-1',
      },
    ];

    await expect(service.forCharacter('fleet-1', KELL)).resolves.toEqual({
      listed: false,
      latestExportAt: LATEST_EXPORT,
      listedSince: null,
      rank: null,
      everListed: true,
    });
  });

  it('reads no history before the Fleet’s first replay', async () => {
    revision = 0;
    exports = [];

    await expect(service.forCharacter('fleet-1', KELL)).resolves.toEqual({
      listed: false,
      latestExportAt: null,
      listedSince: null,
      rank: null,
      everListed: false,
    });
    expect(episodeFind).not.toHaveBeenCalled();
  });

  it('gives no rank when the listing row cannot be read back', async () => {
    rows = [];

    const evidence = await service.forCharacter('fleet-1', KELL);

    expect(evidence.listed).toBe(true);
    expect(evidence.rank).toBeNull();
  });
});
