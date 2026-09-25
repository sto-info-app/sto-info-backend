import { Logger } from '@nestjs/common';

import { DataSource, EntityTarget, FindOperator } from 'typeorm';

import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { RosterIdentityAliasEntity } from '../../identity/entities/roster-identity-alias.entity';
import { RosterIdentityRecomputeService } from '../../identity/services/roster-identity-recompute.service';
import { RosterIdentitySnapshot } from '../../identity/utilities/roster-identity-matcher';
import { RosterImportSourceEntity } from '../../imports/entities/roster-import-source.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { CharacterFleetProposalService } from '../../services/character-fleet-proposal.service';
import { ROSTER_PROJECTION_WRITE_BATCH } from '../constants/roster-replay.constants';
import { RosterChangeEntity } from '../entities/roster-change.entity';
import { RosterEpisodeEntity } from '../entities/roster-episode.entity';
import { RosterIntervalSummaryEntity } from '../entities/roster-interval-summary.entity';
import { RosterProjectionInputEntity } from '../entities/roster-projection-input.entity';
import { RosterProjectionEntity } from '../entities/roster-projection.entity';
import { RosterChangeKind } from '../enums/roster-change-kind.enum';
import { RosterProjectionInputOutcome } from '../enums/roster-projection-input-outcome.enum';
import {
  RosterEvidenceRow,
  RosterEvidenceSnapshot,
  RosterReplayEvidence,
  RosterReplayEvidenceService,
} from './roster-replay-evidence.service';
import { RosterReplayService } from './roster-replay.service';

const FLEET_ID = 'fleet-1';
const JOINED = new Date('2023-01-04T18:00:00.000Z');

type Row = Record<string, unknown>;

/** A row of an effective export, as the evidence reader hands it over. */
const row = (
  name: string,
  handle: string,
  overrides: Partial<RosterEvidenceRow> = {},
): RosterEvidenceRow => ({
  line: 2,
  characterName: name,
  characterNameNormalised: name.toLowerCase(),
  accountHandle: handle,
  accountHandleNormalised: handle.toLowerCase(),
  level: 65,
  className: 'Starfleet Tactical Officer',
  guildRank: 'Captain',
  contributionTotal: '1000',
  joinedAt: JOINED,
  joinedAtAmbiguous: false,
  rankChangedAt: null,
  rankChangedAtAmbiguous: false,
  excluded: false,
  ...overrides,
});

/** An effective export. */
const snapshot = (
  importId: string,
  exportedAt: string,
  rows: RosterEvidenceRow[],
  partial = false,
): RosterEvidenceSnapshot => ({
  importId,
  exportedAt: new Date(exportedAt),
  partial,
  rows,
});

/** The evidence for some effective exports, each listed as an input. */
const evidenceOf = (
  ...snapshots: RosterEvidenceSnapshot[]
): RosterReplayEvidence => ({
  inputs: snapshots.map((each, index) => ({
    id: each.importId,
    exportedAt: each.exportedAt,
    uploadedAt: new Date(index),
    sanitisedSha256: 'a'.repeat(64),
    inForce: true,
    excluded: false,
    partial: each.partial,
    excludedRows: each.rows.filter(r => r.excluded).length,
    conflictGroupId: null,
    outcome: RosterProjectionInputOutcome.EFFECTIVE,
  })),
  snapshots,
});

/** An alias, one identity each unless told otherwise. */
const alias = (name: string, handle: string, identityId?: string): Row => ({
  id: `alias-${name.toLowerCase()}`,
  identityId: identityId ?? `identity-${name.toLowerCase()}`,
  characterNameNormalised: name.toLowerCase(),
  accountHandleNormalised: handle.toLowerCase(),
});

describe('RosterReplayService', () => {
  let projection: Row | null;
  let inserted: Map<EntityTarget<unknown>, Row[]>;
  let manager: Record<string, jest.Mock>;
  let evidence: { read: jest.Mock };
  let identities: { recomputeWithin: jest.Mock };
  let proposals: { raiseFromEvidence: jest.Mock };
  let latestRows: Row[];
  let characters: Row[];
  let service: RosterReplayService;
  let log: jest.SpyInstance;

  const rowsOf = (entity: EntityTarget<unknown>): Row[] =>
    inserted.get(entity) ?? [];

  beforeEach(() => {
    projection = {
      fleetId: FLEET_ID,
      requested: 3,
      built: 1,
      revision: 4,
      publishedAt: new Date('2024-01-01T00:00:00Z'),
      latestImportId: null,
      proposedImportId: null,
    };
    inserted = new Map();
    latestRows = [];
    characters = [];

    manager = {
      query: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn((entity: EntityTarget<unknown>) =>
        Promise.resolve(
          entity === RosterProjectionEntity && projection !== null
            ? { ...projection }
            : null,
        ),
      ),
      findOneOrFail: jest.fn((_entity: EntityTarget<unknown>, options: Row) =>
        Promise.resolve({
          id: (options.where as Row).id,
          exportedAt: new Date('2024-02-01T00:00:00Z'),
        }),
      ),
      find: jest.fn((entity: EntityTarget<unknown>, options: Row) => {
        const where = options.where as Row;

        if (entity === RosterObservationEntity) {
          return Promise.resolve(latestRows);
        }

        if (entity === CharacterEntity) {
          return Promise.resolve(
            characters.filter(each =>
              (
                (where.fullHandleNormalized as FindOperator<string[]>)
                  .value as unknown as string[]
              ).includes(each.fullHandleNormalized as string),
            ),
          );
        }

        throw new Error('Unexpected find');
      }),
      insert: jest.fn((entity: EntityTarget<unknown>, rows: Row[]) => {
        inserted.set(entity, [...rowsOf(entity), ...rows]);

        return Promise.resolve();
      }),
      update: jest.fn(
        (entity: EntityTarget<unknown>, _criteria: Row, values: Row) => {
          if (entity === RosterProjectionEntity && projection !== null) {
            Object.assign(projection, values);
          }

          return Promise.resolve();
        },
      ),
      delete: jest.fn(() => Promise.resolve()),
    };

    evidence = { read: jest.fn(() => Promise.resolve(evidenceOf())) };
    identities = {
      recomputeWithin: jest.fn(() =>
        Promise.resolve({
          aliases: [],
          summary: {
            aliases: 0,
            inserted: 0,
            refreshed: 0,
            restaled: 0,
            deleted: 0,
            reassigned: 0,
          },
        }),
      ),
    };
    proposals = {
      raiseFromEvidence: jest.fn(() => Promise.resolve({ id: 'proposal-1' })),
    };

    service = new RosterReplayService(
      {
        manager,
        transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
          work(manager),
        ),
      } as unknown as DataSource,
      evidence as unknown as RosterReplayEvidenceService,
      identities as unknown as RosterIdentityRecomputeService,
      proposals as unknown as CharacterFleetProposalService,
    );

    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Gives the recompute some aliases to hand back. */
  const aliases = (...rows: Row[]): void => {
    identities.recomputeWithin.mockResolvedValue({
      aliases: rows as unknown as RosterIdentityAliasEntity[],
      summary: {
        aliases: rows.length,
        inserted: 0,
        refreshed: 0,
        restaled: 0,
        deleted: 0,
        reassigned: 0,
      },
    });
  };

  // Shared with a reviewer's decision, so the two never interleave.
  it("takes the Fleet's identity lock", async () => {
    await service.replay(FLEET_ID);

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`fleet-roster-identity:${FLEET_ID}`],
    );
  });

  describe('when nothing is asked of it', () => {
    it('builds nothing for a Fleet nothing has ever asked about', async () => {
      projection = null;

      await expect(service.replay(FLEET_ID)).resolves.toEqual({
        built: false,
        revision: 0,
        imports: 0,
        episodes: 0,
        changes: 0,
        intervals: 0,
        identities: null,
        proposed: 0,
      });
      expect(evidence.read).not.toHaveBeenCalled();
    });

    // A duplicate, or a retry after a publish: the counters say so.
    it('builds nothing when the published revision already covers every request', async () => {
      projection!.built = 3;

      await expect(service.replay(FLEET_ID)).resolves.toMatchObject({
        built: false,
        revision: 4,
      });
      expect(evidence.read).not.toHaveBeenCalled();
      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });
  });

  describe('building a revision', () => {
    beforeEach(() => {
      evidence.read.mockResolvedValue(
        evidenceOf(
          snapshot('i1', '2024-01-01T00:00:00Z', [
            row('Kira', '@one', { contributionTotal: '100' }),
            row('Odo', '@two'),
          ]),
          snapshot('i2', '2024-02-01T00:00:00Z', [
            row('Kira', '@one', { contributionTotal: '150' }),
          ]),
        ),
      );
      aliases(alias('Kira', '@one'), alias('Odo', '@two'));
    });

    it('reads the evidence and recomputes identities in its transaction', async () => {
      await service.replay(FLEET_ID);

      expect(evidence.read).toHaveBeenCalledWith(manager, FLEET_ID);
      expect(identities.recomputeWithin).toHaveBeenCalledWith(
        manager,
        FLEET_ID,
        [
          expect.objectContaining({ importId: 'i1', complete: true }),
          expect.objectContaining({ importId: 'i2', complete: true }),
        ],
      );
    });

    it('writes the next revision beside the published one', async () => {
      await service.replay(FLEET_ID);

      expect(rowsOf(RosterProjectionInputEntity)).toEqual([
        {
          fleetId: FLEET_ID,
          revision: 5,
          importSourceId: 'i1',
          exportedAt: new Date('2024-01-01T00:00:00Z'),
          outcome: RosterProjectionInputOutcome.EFFECTIVE,
          partial: false,
          excludedRows: 0,
        },
        expect.objectContaining({ revision: 5, importSourceId: 'i2' }),
      ]);
      expect(rowsOf(RosterEpisodeEntity)).toEqual([
        expect.objectContaining({
          fleetId: FLEET_ID,
          revision: 5,
          identityId: 'identity-kira',
          ordinal: 1,
          firstImportId: 'i1',
          lastImportId: 'i2',
          endKind: null,
          baselineContribution: '100',
          lastObservedContribution: '150',
        }),
        expect.objectContaining({
          identityId: 'identity-odo',
          lastImportId: 'i1',
          endedBeforeImportId: 'i2',
        }),
      ]);
      expect(rowsOf(RosterChangeEntity)).toEqual([
        expect.objectContaining({
          revision: 5,
          identityId: 'identity-kira',
          kind: RosterChangeKind.CONTRIBUTION_CHANGED,
          fromImportId: 'i1',
          toImportId: 'i2',
          contributionDelta: '50',
        }),
        expect.objectContaining({
          identityId: 'identity-odo',
          kind: RosterChangeKind.LEFT,
        }),
      ]);
      expect(rowsOf(RosterIntervalSummaryEntity)).toEqual([
        expect.objectContaining({
          fleetId: FLEET_ID,
          revision: 5,
          fromImportId: 'i1',
          toImportId: 'i2',
          left: 1,
          contributionDelta: '50',
        }),
      ]);
    });

    it('writes episodes before the changes that refer to them', async () => {
      await service.replay(FLEET_ID);

      const order = manager.insert.mock.calls.map(([entity]) => entity);

      expect(order.indexOf(RosterEpisodeEntity)).toBeLessThan(
        order.indexOf(RosterChangeEntity),
      );
    });

    it('publishes it with the request it was built for and its latest export', async () => {
      await expect(service.replay(FLEET_ID)).resolves.toMatchObject({
        built: true,
        revision: 5,
        imports: 2,
        episodes: 2,
        changes: 2,
        intervals: 1,
      });
      expect(manager.update).toHaveBeenCalledWith(
        RosterProjectionEntity,
        { fleetId: FLEET_ID },
        {
          revision: 5,
          built: 3,
          publishedAt: expect.any(Date),
          latestImportId: 'i2',
        },
      );
    });

    // A reader that pinned revision 4 just before the switch still finds it.
    it('keeps the revision before and deletes any older', async () => {
      await service.replay(FLEET_ID);

      for (const entity of [
        RosterChangeEntity,
        RosterEpisodeEntity,
        RosterIntervalSummaryEntity,
        RosterProjectionInputEntity,
      ]) {
        expect(manager.delete).toHaveBeenCalledWith(entity, {
          fleetId: FLEET_ID,
          revision: expect.objectContaining({ _type: 'lessThan', _value: 4 }),
        });
      }
    });

    it("dates the Fleet's roster by its latest effective export", async () => {
      await service.replay(FLEET_ID);

      expect(manager.update).toHaveBeenCalledWith(
        StoFleetEntity,
        { id: FLEET_ID },
        { lastEffectiveImportAt: new Date('2024-02-01T00:00:00Z') },
      );
    });

    // Steve's decision of 25 September 2026: the date follows the revision,
    // back as well as forward.
    it('clears the date when no export is effective any more', async () => {
      evidence.read.mockResolvedValue(evidenceOf());

      await service.replay(FLEET_ID);

      expect(manager.update).toHaveBeenCalledWith(
        StoFleetEntity,
        { id: FLEET_ID },
        { lastEffectiveImportAt: null },
      );
      expect(manager.update).toHaveBeenCalledWith(
        RosterProjectionEntity,
        { fleetId: FLEET_ID },
        expect.objectContaining({ latestImportId: null }),
      );
    });

    it('writes a large revision in batches', async () => {
      const members = Array.from(
        { length: ROSTER_PROJECTION_WRITE_BATCH + 1 },
        (_value, index) => row(`Member ${index}`, `@m${index}`),
      );

      evidence.read.mockResolvedValue(
        evidenceOf(snapshot('i1', '2024-01-01T00:00:00Z', members)),
      );
      aliases(
        ...members.map(each => alias(each.characterName, each.accountHandle)),
      );

      await service.replay(FLEET_ID);

      expect(
        manager.insert.mock.calls.filter(
          ([entity]) => entity === RosterEpisodeEntity,
        ),
      ).toHaveLength(2);
      expect(rowsOf(RosterEpisodeEntity)).toHaveLength(
        ROSTER_PROJECTION_WRITE_BATCH + 1,
      );
    });

    it('logs what it did in counts, and nothing a roster said', async () => {
      await service.replay(FLEET_ID);

      expect(log).toHaveBeenCalledWith(
        `[replay] Roster replayed - FleetId: ${FLEET_ID}, Built: true, ` +
          'Revision: 5, Imports: 2, Episodes: 2, Changes: 2, Intervals: 1, ' +
          'Proposed: 0',
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain('Kira');
    });
  });

  describe('what counts as evidence', () => {
    it('keeps excluded rows from the identity matcher and marks their export incomplete', async () => {
      evidence.read.mockResolvedValue(
        evidenceOf(
          snapshot('i1', '2024-01-01T00:00:00Z', [
            row('Kira', '@one'),
            row('Odo', '@two', { excluded: true }),
          ]),
          snapshot('i2', '2024-02-01T00:00:00Z', [row('Kira', '@one')], true),
        ),
      );
      aliases(alias('Kira', '@one'));

      await service.replay(FLEET_ID);

      const [[, , snapshots]] = identities.recomputeWithin.mock.calls as [
        [unknown, unknown, RosterIdentitySnapshot[]],
      ];

      expect(
        snapshots.map(each => [
          each.importId,
          each.complete,
          each.rows.map(r => r.characterName),
        ]),
      ).toEqual([
        ['i1', false, ['Kira']],
        ['i2', false, ['Kira']],
      ]);
    });

    // An excluded row is unknown, not absent: Odo is on both sides of it
    // and has not left.
    it('leaves a member whose row is excluded unknown rather than gone', async () => {
      evidence.read.mockResolvedValue(
        evidenceOf(
          snapshot('i1', '2024-01-01T00:00:00Z', [row('Odo', '@two')]),
          snapshot('i2', '2024-02-01T00:00:00Z', [
            row('Odo', '@two', { excluded: true }),
            row('Stranger', '@who', { excluded: true }),
          ]),
          snapshot('i3', '2024-03-01T00:00:00Z', [row('Odo', '@two')]),
        ),
      );
      aliases(alias('Odo', '@two'));

      await service.replay(FLEET_ID);

      expect(rowsOf(RosterChangeEntity)).toEqual([]);
      expect(rowsOf(RosterIntervalSummaryEntity)).toEqual([
        expect.objectContaining({ unknown: 1, left: 0 }),
        expect.objectContaining({ left: 0, joined: 0 }),
      ]);
    });

    // A confirmed rename puts both names in one identity, so the projection
    // sees one member renamed rather than one leaving and another joining.
    it('reads each row as the identity its alias now belongs to', async () => {
      evidence.read.mockResolvedValue(
        evidenceOf(
          snapshot('i1', '2024-01-01T00:00:00Z', [row('Kess Varro', '@k')]),
          snapshot('i2', '2024-02-01T00:00:00Z', [row('Kess Tarin', '@k')]),
        ),
      );
      aliases(
        alias('Kess Varro', '@k', 'identity-kess'),
        alias('Kess Tarin', '@k', 'identity-kess'),
      );

      await service.replay(FLEET_ID);

      expect(rowsOf(RosterEpisodeEntity)).toHaveLength(1);
      expect(rowsOf(RosterChangeEntity)).toEqual([
        expect.objectContaining({
          kind: RosterChangeKind.RENAMED,
          detail: {
            fromCharacterName: 'Kess Varro',
            fromAccountHandle: '@k',
            toCharacterName: 'Kess Tarin',
            toAccountHandle: '@k',
          },
        }),
      ]);
    });
  });

  describe('proposals', () => {
    beforeEach(() => {
      evidence.read.mockResolvedValue(
        evidenceOf(
          snapshot('i2', '2024-02-01T00:00:00Z', [
            row('Kira Nerys', '@Bajor#1234'),
          ]),
        ),
      );
      aliases(alias('Kira Nerys', '@Bajor#1234'));
      latestRows = [
        { characterName: 'Kira Nerys', accountHandle: '@Bajor#1234' },
        { characterName: 'Odo', accountHandle: '@changeling' },
      ];
      characters = [
        { id: 'character-kira', fullHandleNormalized: 'kira nerys@bajor#1234' },
        { id: 'character-elsewhere', fullHandleNormalized: 'quark@ferengi' },
      ];
    });

    // STO Info account handles cannot begin with an @, so the roster's is
    // dropped before the two are compared.
    it('offers each registered Character the latest export names exactly', async () => {
      await expect(service.replay(FLEET_ID)).resolves.toMatchObject({
        proposed: 1,
      });
      expect(proposals.raiseFromEvidence).toHaveBeenCalledTimes(1);
      expect(proposals.raiseFromEvidence).toHaveBeenCalledWith(
        'character-kira',
        {
          fleetId: FLEET_ID,
          evidenceImportId: 'i2',
          observedAt: new Date('2024-02-01T00:00:00Z'),
        },
      );
    });

    it('reads only the rows that count, after the revision is committed', async () => {
      await service.replay(FLEET_ID);

      expect(manager.find).toHaveBeenCalledWith(RosterObservationEntity, {
        where: { importSourceId: 'i2', excluded: false },
        select: { characterName: true, accountHandle: true },
      });
      expect(manager.findOneOrFail).toHaveBeenCalledWith(
        RosterImportSourceEntity,
        expect.objectContaining({ where: { id: 'i2' } }),
      );
    });

    it('records that they were raised, against the export they were raised from', async () => {
      await service.replay(FLEET_ID);

      expect(manager.update).toHaveBeenLastCalledWith(
        RosterProjectionEntity,
        { fleetId: FLEET_ID, latestImportId: 'i2' },
        { proposedImportId: 'i2' },
      );
    });

    it('counts only the Characters a proposal is open for', async () => {
      proposals.raiseFromEvidence.mockResolvedValue(null);

      await expect(service.replay(FLEET_ID)).resolves.toMatchObject({
        proposed: 0,
      });
    });

    it('asks nothing when the latest export lists nobody', async () => {
      latestRows = [];

      await service.replay(FLEET_ID);

      expect(manager.find).not.toHaveBeenCalledWith(
        CharacterEntity,
        expect.anything(),
      );
    });

    // FC-019's fourth criterion: a replay that changed history but not the
    // latest export must not ask anybody anything again.
    it('asks nobody again when the latest export has not changed', async () => {
      projection!.proposedImportId = 'i2';

      await service.replay(FLEET_ID);

      expect(proposals.raiseFromEvidence).not.toHaveBeenCalled();
    });

    // A crash after the publish and before the proposals leaves the two
    // apart; the next job finds nothing to build and finishes the proposals.
    it('raises what a crashed replay did not, even with nothing to build', async () => {
      Object.assign(projection!, { built: 3, latestImportId: 'i2' });

      await expect(service.replay(FLEET_ID)).resolves.toMatchObject({
        built: false,
        proposed: 1,
      });
      expect(evidence.read).not.toHaveBeenCalled();
    });

    it('records none raised when no export is effective any more', async () => {
      Object.assign(projection!, {
        built: 3,
        latestImportId: null,
        proposedImportId: 'i2',
      });

      await service.replay(FLEET_ID);

      expect(proposals.raiseFromEvidence).not.toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(
        RosterProjectionEntity,
        {
          fleetId: FLEET_ID,
          latestImportId: expect.objectContaining({ _type: 'isNull' }),
        },
        { proposedImportId: null },
      );
    });
  });
});
