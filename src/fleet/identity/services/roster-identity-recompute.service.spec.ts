import { Logger } from '@nestjs/common';

import { DataSource, EntityTarget, FindOperator } from 'typeorm';

import { FileAssetPlacementEntity } from 'src/file-assets/entities/file-asset-placement.entity';
import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { RosterImportSourceEntity } from '../../imports/entities/roster-import-source.entity';
import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { CharacterFleetProposalService } from '../../services/character-fleet-proposal.service';
import { ROSTER_IDENTITY_WRITE_BATCH } from '../constants/roster-identity.constants';
import { RosterIdentityAliasEntity } from '../entities/roster-identity-alias.entity';
import { RosterIdentityCandidateLinkEntity } from '../entities/roster-identity-candidate-link.entity';
import { RosterIdentityCandidateEntity } from '../entities/roster-identity-candidate.entity';
import { RosterIdentityEntity } from '../entities/roster-identity.entity';
import { RosterIdentityCandidateKind } from '../enums/roster-identity-candidate-kind.enum';
import { RosterIdentityCandidateState } from '../enums/roster-identity-candidate-state.enum';
import { RosterIdentityConfidence } from '../enums/roster-identity-confidence.enum';
import { RosterIdentityRecomputeService } from './roster-identity-recompute.service';

const FLEET_ID = 'fleet-1';
const JOINED = new Date('2023-01-04T18:00:00.000Z');

type Row = Record<string, unknown>;

/**
 * The tables a recompute touches, held in memory.
 *
 * Only as much of TypeORM as the service uses: `find` with equality and
 * `In()`, `insert`, `upsert` on the alias key, `update` and `delete` by
 * identifier. It is enough to run the real matcher and planner against rows
 * that change between two recomputes, which is where the service's own rules
 * live.
 */
class FakeTables {
  imports: Row[] = [];
  placements: Row[] = [];
  observations = new Map<string, Row[]>();
  identities: Row[] = [];
  aliases: Row[] = [];
  candidates: Row[] = [];
  links: Row[] = [];
  characters: Row[] = [];
  private clock = 0;

  /**
   * Adds an in-force import.
   *
   * @param id - The import.
   * @param exportedAt - When its export was taken.
   * @param rows - Its observations.
   * @param state - Its placement's state.
   */
  addImport(
    id: string,
    exportedAt: string,
    rows: Row[],
    state = FileAssetPlacementState.ACTIVE,
  ): void {
    this.imports.push({
      id,
      fleetId: FLEET_ID,
      exportedAt: new Date(exportedAt),
    });
    this.placements.push({
      subject: FileAssetSubject.ROSTER_IMPORT,
      subjectId: id,
      state,
    });
    this.observations.set(id, rows);
  }

  find = jest.fn((entity: EntityTarget<unknown>, options: Row = {}) => {
    const where = (options.where ?? {}) as Row;

    switch (entity) {
      case RosterImportSourceEntity:
        return Promise.resolve(
          [...this.imports].sort(
            (a, b) =>
              (a.exportedAt as Date).getTime() -
                (b.exportedAt as Date).getTime() ||
              String(a.id).localeCompare(String(b.id)),
          ),
        );
      case FileAssetPlacementEntity:
        return Promise.resolve(
          this.placements.filter(
            placement =>
              placement.subject === where.subject &&
              placement.state === where.state &&
              this.within(where.subjectId, placement.subjectId),
          ),
        );
      case RosterObservationEntity:
        return Promise.resolve(
          this.observations.get(where.importSourceId as string) ?? [],
        );
      case RosterIdentityAliasEntity:
        return Promise.resolve(this.aliases.map(alias => ({ ...alias })));
      case RosterIdentityCandidateEntity:
        return Promise.resolve(
          this.candidates
            .filter(
              candidate =>
                where.state === undefined || candidate.state === where.state,
            )
            .map(candidate => ({
              ...candidate,
              links: this.links.filter(
                link => link.candidateId === candidate.id,
              ),
            })),
        );
      case CharacterEntity:
        return Promise.resolve(
          this.characters.filter(character =>
            this.within(
              where.fullHandleNormalized,
              character.fullHandleNormalized,
            ),
          ),
        );
      default:
        throw new Error('Unexpected find');
    }
  });

  insert = jest.fn((entity: EntityTarget<unknown>, rows: Row[]) => {
    const table = this.tableOf(entity);

    for (const row of rows) {
      table.push(
        entity === RosterIdentityCandidateEntity
          ? {
              state: RosterIdentityCandidateState.OPEN,
              stale: false,
              revision: 0,
              ...row,
            }
          : { ...row },
      );
    }

    return Promise.resolve();
  });

  upsert = jest.fn((_entity: EntityTarget<unknown>, rows: Row[]) => {
    for (const row of rows) {
      const existing = this.aliases.find(
        alias =>
          alias.characterNameNormalised === row.characterNameNormalised &&
          alias.accountHandleNormalised === row.accountHandleNormalised,
      );

      if (existing === undefined) {
        this.clock += 1;
        this.aliases.push({ ...row, createdAt: new Date(this.clock) });
      } else {
        Object.assign(existing, row);
      }
    }

    return Promise.resolve();
  });

  update = jest.fn(
    (entity: EntityTarget<unknown>, criteria: Row, values: Row) => {
      for (const row of this.tableOf(entity)) {
        if (this.within(criteria.id, row.id)) {
          Object.assign(row, values);
        }
      }

      return Promise.resolve();
    },
  );

  delete = jest.fn((entity: EntityTarget<unknown>, criteria: Row) => {
    if (entity === RosterIdentityCandidateLinkEntity) {
      this.links = this.links.filter(
        link => link.candidateId !== criteria.candidateId,
      );
    } else {
      const doomed = this.candidates.filter(candidate =>
        this.within(criteria.id, candidate.id),
      );

      this.candidates = this.candidates.filter(
        candidate => !doomed.includes(candidate),
      );
      this.links = this.links.filter(
        link => !doomed.some(candidate => candidate.id === link.candidateId),
      );
    }

    return Promise.resolve();
  });

  query = jest.fn(() => Promise.resolve([]));

  /**
   * Whether a value satisfies an equality or `In()` condition.
   *
   * @param condition - The condition.
   * @param value - The value.
   * @returns True if it does.
   */
  private within(condition: unknown, value: unknown): boolean {
    return condition instanceof FindOperator
      ? (condition.value as unknown[]).includes(value)
      : condition === value;
  }

  /**
   * The array standing in for an entity's table.
   *
   * @param entity - The entity.
   * @returns Its rows.
   */
  private tableOf(entity: EntityTarget<unknown>): Row[] {
    switch (entity) {
      case RosterIdentityEntity:
        return this.identities;
      case RosterIdentityAliasEntity:
        return this.aliases;
      case RosterIdentityCandidateEntity:
        return this.candidates;
      case RosterIdentityCandidateLinkEntity:
        return this.links;
      default:
        throw new Error('Unexpected write');
    }
  }
}

/**
 * Builds an observation, as the recompute reads it.
 *
 * @param name - The Character name.
 * @param handle - The account handle.
 * @param overrides - Anything that differs.
 * @returns The observation.
 */
function observed(name: string, handle: string, overrides: Row = {}): Row {
  return {
    characterName: name,
    characterNameNormalised: name.toLowerCase(),
    accountHandle: handle,
    accountHandleNormalised: handle.toLowerCase(),
    level: 65,
    className: 'Starfleet Tactical Officer',
    contributionTotal: '1000',
    joinedAt: JOINED,
    joinedAtAmbiguous: false,
    rankChangedAt: null,
    rankChangedAtAmbiguous: false,
    ...overrides,
  };
}

describe('RosterIdentityRecomputeService', () => {
  let tables: FakeTables;
  let proposals: { raiseFromEvidence: jest.Mock };
  let service: RosterIdentityRecomputeService;
  let log: jest.SpyInstance;

  /**
   * The alias for a name and handle.
   *
   * @param name - The normalised name.
   * @param handle - The normalised handle.
   * @returns The alias row.
   */
  const alias = (name: string, handle: string): Row =>
    tables.aliases.find(
      each =>
        each.characterNameNormalised === name &&
        each.accountHandleNormalised === handle,
    )!;

  beforeEach(() => {
    tables = new FakeTables();
    proposals = {
      raiseFromEvidence: jest.fn(() => Promise.resolve({ id: 'proposal-1' })),
    };

    const manager = tables;

    service = new RosterIdentityRecomputeService(
      {
        manager,
        transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
          work(manager),
        ),
      } as unknown as DataSource,
      proposals as unknown as CharacterFleetProposalService,
    );

    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('serialises recomputes of one Fleet behind a lock', async () => {
    await service.recompute(FLEET_ID);

    expect(tables.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`fleet-roster-identity:${FLEET_ID}`],
    );
  });

  it('does nothing for a Fleet with no imports', async () => {
    await expect(service.recompute(FLEET_ID)).resolves.toEqual({
      imports: 0,
      aliases: 0,
      inserted: 0,
      refreshed: 0,
      restaled: 0,
      deleted: 0,
      reassigned: 0,
      proposed: 0,
    });
    expect(tables.find).not.toHaveBeenCalledWith(
      FileAssetPlacementEntity,
      expect.anything(),
    );
    expect(proposals.raiseFromEvidence).not.toHaveBeenCalled();
  });

  describe('reading the evidence', () => {
    it('reads only imports in force, and asks for them by placement', async () => {
      tables.addImport('import-1', '2024-01-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);
      tables.addImport(
        'import-held',
        '2024-02-01T00:00:00Z',
        [observed('Odo', '@two')],
        FileAssetPlacementState.HELD,
      );

      const summary = await service.recompute(FLEET_ID);

      expect(summary.imports).toBe(1);
      expect(tables.aliases).toHaveLength(1);
      expect(tables.find).toHaveBeenCalledWith(
        FileAssetPlacementEntity,
        expect.objectContaining({
          where: expect.objectContaining({
            subject: FileAssetSubject.ROSTER_IMPORT,
            state: FileAssetPlacementState.ACTIVE,
          }),
        }),
      );
    });

    // Any two in force at one instant have the same sanitised contents.
    it('passes over a second in-force import claiming the same instant', async () => {
      tables.addImport('import-1', '2024-01-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);
      tables.addImport('import-2', '2024-01-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);

      await expect(service.recompute(FLEET_ID)).resolves.toMatchObject({
        imports: 1,
      });
    });

    it('reads observations in line order, and only the columns it matches on', async () => {
      tables.addImport('import-1', '2024-01-01T00:00:00Z', []);

      await service.recompute(FLEET_ID);

      expect(tables.find).toHaveBeenCalledWith(RosterObservationEntity, {
        where: { importSourceId: 'import-1' },
        select: expect.not.objectContaining({ publicComment: true }),
        order: { line: 'ASC' },
      });
    });
  });

  describe('aliases', () => {
    it('gives a new alias an identity of its own', async () => {
      tables.addImport('import-1', '2024-01-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);

      await service.recompute(FLEET_ID);

      const kira = alias('kira', '@one');

      expect(tables.identities).toEqual([
        { id: kira.identityId, fleetId: FLEET_ID },
      ]);
      expect(kira).toMatchObject({
        fleetId: FLEET_ID,
        originIdentityId: kira.identityId,
        characterName: 'Kira',
        accountHandle: '@one',
        firstObservedAt: new Date('2024-01-01T00:00:00Z'),
        lastObservedAt: new Date('2024-01-01T00:00:00Z'),
      });
    });

    it('keeps an alias’s identity and moves its dates when seen again', async () => {
      tables.addImport('import-1', '2024-01-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);
      await service.recompute(FLEET_ID);
      const before = { ...alias('kira', '@one') };

      tables.addImport('import-2', '2024-02-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);
      await service.recompute(FLEET_ID);

      expect(tables.identities).toHaveLength(1);
      expect(alias('kira', '@one')).toMatchObject({
        id: before.id,
        identityId: before.identityId,
        lastObservedAt: new Date('2024-02-01T00:00:00Z'),
      });
    });

    it('writes nothing for an alias that has not changed', async () => {
      tables.addImport('import-1', '2024-01-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);
      await service.recompute(FLEET_ID);
      tables.upsert.mockClear();

      await service.recompute(FLEET_ID);

      expect(tables.upsert).not.toHaveBeenCalled();
    });

    // Its import left force, but a decision may cite it, so the row stays.
    it('keeps an alias no in-force export lists, with its dates cleared', async () => {
      tables.addImport('import-1', '2024-01-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);
      await service.recompute(FLEET_ID);

      tables.placements[0].state = FileAssetPlacementState.WITHDRAWN;
      await service.recompute(FLEET_ID);

      expect(alias('kira', '@one')).toMatchObject({
        firstObservedAt: null,
        lastObservedAt: null,
      });

      tables.update.mockClear();
      await service.recompute(FLEET_ID);

      expect(tables.update).not.toHaveBeenCalledWith(
        RosterIdentityAliasEntity,
        expect.anything(),
        { firstObservedAt: null, lastObservedAt: null },
      );
    });

    it('writes a first import of many members in batches', async () => {
      const members = Array.from(
        { length: ROSTER_IDENTITY_WRITE_BATCH + 1 },
        (_value, index) => observed(`Member ${index}`, `@member${index}`),
      );

      tables.addImport('import-1', '2024-01-01T00:00:00Z', members);

      await service.recompute(FLEET_ID);

      expect(tables.insert).toHaveBeenCalledTimes(2);
      expect(tables.upsert).toHaveBeenCalledTimes(2);
      expect(tables.upsert).toHaveBeenCalledWith(
        RosterIdentityAliasEntity,
        expect.any(Array),
        {
          conflictPaths: [
            'fleetId',
            'characterNameNormalised',
            'accountHandleNormalised',
          ],
        },
      );
      expect(tables.aliases).toHaveLength(ROSTER_IDENTITY_WRITE_BATCH + 1);
    });
  });

  describe('candidates', () => {
    beforeEach(() => {
      tables.addImport('import-1', '2024-01-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);
      tables.addImport('import-2', '2024-02-01T00:00:00Z', [
        observed('Nerys', '@one'),
      ]);
    });

    it('records a rename the evidence suggests, with its link', async () => {
      await expect(service.recompute(FLEET_ID)).resolves.toMatchObject({
        inserted: 1,
      });

      const [candidate] = tables.candidates;

      expect(candidate).toMatchObject({
        fleetId: FLEET_ID,
        kind: RosterIdentityCandidateKind.CHARACTER_RENAME,
        state: RosterIdentityCandidateState.OPEN,
        fromAliasId: alias('kira', '@one').id,
        toAliasId: alias('nerys', '@one').id,
        fromHandleNormalised: null,
        toHandleNormalised: null,
        earlierImportId: 'import-1',
        laterImportId: 'import-2',
        confidence: RosterIdentityConfidence.HIGH,
        collisionReasons: [],
      });
      expect(tables.links).toEqual([
        {
          candidateId: candidate.id,
          fleetId: FLEET_ID,
          fromAliasId: alias('kira', '@one').id,
          toAliasId: alias('nerys', '@one').id,
        },
      ]);
    });

    it('records an account rename by its handles', async () => {
      tables.observations.set('import-2', [observed('Kira', '@two')]);

      await service.recompute(FLEET_ID);

      expect(tables.candidates[0]).toMatchObject({
        kind: RosterIdentityCandidateKind.ACCOUNT_RENAME,
        fromAliasId: null,
        toAliasId: null,
        fromHandleNormalised: '@one',
        toHandleNormalised: '@two',
      });
    });

    it('rewrites an open one from the evidence, links and all', async () => {
      await service.recompute(FLEET_ID);
      const [first] = tables.candidates;

      tables.candidates[0].stale = true;
      tables.observations.set('import-2', [
        observed('Nerys', '@one', { level: 50 }),
      ]);

      await expect(service.recompute(FLEET_ID)).resolves.toMatchObject({
        inserted: 0,
        refreshed: 1,
      });
      expect(tables.candidates).toEqual([
        expect.objectContaining({
          id: first.id,
          confidence: RosterIdentityConfidence.MEDIUM,
          stale: false,
        }),
      ]);
      expect(tables.links).toHaveLength(1);
    });

    // An older export imported late now sits between the two.
    it('removes an undecided one the evidence no longer suggests', async () => {
      await service.recompute(FLEET_ID);

      tables.addImport('import-between', '2024-01-15T00:00:00Z', []);

      await expect(service.recompute(FLEET_ID)).resolves.toMatchObject({
        deleted: 1,
      });
      expect(tables.candidates).toEqual([]);
      expect(tables.links).toEqual([]);
    });

    it('keeps a decided one the evidence no longer suggests, flagged', async () => {
      await service.recompute(FLEET_ID);
      Object.assign(tables.candidates[0], {
        state: RosterIdentityCandidateState.REJECTED,
        revision: 1,
      });

      tables.addImport('import-between', '2024-01-15T00:00:00Z', []);

      await expect(service.recompute(FLEET_ID)).resolves.toMatchObject({
        restaled: 1,
      });
      expect(tables.candidates[0]).toMatchObject({
        state: RosterIdentityCandidateState.REJECTED,
        stale: true,
      });

      tables.imports = tables.imports.filter(
        each => each.id !== 'import-between',
      );

      await service.recompute(FLEET_ID);

      expect(tables.candidates[0].stale).toBe(false);
    });
  });

  describe('identities', () => {
    beforeEach(async () => {
      tables.addImport('import-1', '2024-01-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);
      tables.addImport('import-2', '2024-02-01T00:00:00Z', [
        observed('Nerys', '@one'),
      ]);
      await service.recompute(FLEET_ID);
    });

    it('leaves each alias its own identity while nothing is confirmed', () => {
      expect(alias('nerys', '@one').identityId).toBe(
        alias('nerys', '@one').originIdentityId,
      );
    });

    it('joins a confirmed rename into the identity seen first', async () => {
      tables.candidates[0].state = RosterIdentityCandidateState.CONFIRMED;

      await expect(service.recompute(FLEET_ID)).resolves.toMatchObject({
        reassigned: 1,
      });
      expect(alias('nerys', '@one').identityId).toBe(
        alias('kira', '@one').identityId,
      );
    });

    it('separates them again once the confirmation is undone', async () => {
      tables.candidates[0].state = RosterIdentityCandidateState.CONFIRMED;
      await service.recompute(FLEET_ID);

      tables.candidates[0].state = RosterIdentityCandidateState.OPEN;
      await service.recompute(FLEET_ID);

      expect(alias('nerys', '@one').identityId).toBe(
        alias('nerys', '@one').originIdentityId,
      );
    });
  });

  describe('proposals', () => {
    beforeEach(() => {
      tables.addImport('import-1', '2024-01-01T00:00:00Z', [
        observed('Old Name', '@gone'),
      ]);
      tables.addImport('import-2', '2024-02-01T00:00:00Z', [
        observed('Kira Nerys', '@Bajor#1234'),
        observed('Odo', '@changeling'),
      ]);
      tables.characters = [
        { id: 'character-kira', fullHandleNormalized: 'kira nerys@bajor#1234' },
        { id: 'character-elsewhere', fullHandleNormalized: 'old name@gone' },
      ];
    });

    // STO Info account handles cannot begin with an @, so the roster's is
    // dropped before the two are compared.
    it('offers each registered Character the latest export names exactly', async () => {
      await expect(service.recompute(FLEET_ID)).resolves.toMatchObject({
        proposed: 1,
      });
      expect(proposals.raiseFromEvidence).toHaveBeenCalledTimes(1);
      expect(proposals.raiseFromEvidence).toHaveBeenCalledWith(
        'character-kira',
        {
          fleetId: FLEET_ID,
          evidenceImportId: 'import-2',
          observedAt: new Date('2024-02-01T00:00:00Z'),
        },
      );
    });

    it('counts only the Characters a proposal is open for', async () => {
      proposals.raiseFromEvidence.mockResolvedValue(null);

      await expect(service.recompute(FLEET_ID)).resolves.toMatchObject({
        proposed: 0,
      });
    });

    it('asks nothing when the latest export lists nobody', async () => {
      tables.observations.set('import-2', []);

      await service.recompute(FLEET_ID);

      expect(tables.find).not.toHaveBeenCalledWith(
        CharacterEntity,
        expect.anything(),
      );
    });
  });

  it('logs what it did in counts, and nothing a roster said', async () => {
    tables.addImport('import-1', '2024-01-01T00:00:00Z', [
      observed('Kira', '@one'),
    ]);

    await service.recompute(FLEET_ID);

    expect(log).toHaveBeenCalledWith(
      `[recompute] Roster identities recomputed - FleetId: ${FLEET_ID}, ` +
        'Imports: 1, Aliases: 1, Inserted: 0, Refreshed: 0, Restaled: 0, ' +
        'Deleted: 0, Reassigned: 0, Proposed: 0',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('Kira');
  });
});
