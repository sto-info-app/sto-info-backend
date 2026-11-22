import { EntityManager, EntityTarget, FindOperator } from 'typeorm';

import { FileAssetPlacementState } from 'src/file-assets/enums/file-asset-placement-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';

import { ROSTER_IDENTITY_WRITE_BATCH } from '../constants/roster-identity.constants';
import { RosterIdentityAliasEntity } from '../entities/roster-identity-alias.entity';
import { RosterIdentityCandidateLinkEntity } from '../entities/roster-identity-candidate-link.entity';
import { RosterIdentityCandidateEntity } from '../entities/roster-identity-candidate.entity';
import { RosterIdentityEntity } from '../entities/roster-identity.entity';
import { RosterIdentityCandidateKind } from '../enums/roster-identity-candidate-kind.enum';
import { RosterIdentityCandidateState } from '../enums/roster-identity-candidate-state.enum';
import { RosterIdentityConfidence } from '../enums/roster-identity-confidence.enum';
import { RosterIdentitySnapshot } from '../utilities/roster-identity-matcher';
import {
  RosterIdentityRecomputeService,
  RosterIdentityRecomputeSummary,
} from './roster-identity-recompute.service';

const FLEET_ID = 'fleet-1';
const JOINED = new Date('2023-01-04T18:00:00.000Z');

type Row = Record<string, unknown>;

/**
 * The tables a recompute touches, held in memory.
 *
 * Only as much of TypeORM as the service uses: `find` with equality,
 * `insert`, `upsert` on the alias key, `update` and `delete` by identifier.
 * It is enough to run the real matcher and planner against rows that change
 * between two recomputes, which is where the service's own rules live.
 *
 * The imports are kept here too, although the recompute no longer reads
 * them: the replay does, and hands it snapshots. {@link snapshotsOf} stands
 * in for that, so a test can change an import and recompute again.
 */
class FakeTables {
  imports: Row[] = [];
  placements: Row[] = [];
  observations = new Map<string, Row[]>();
  identities: Row[] = [];
  aliases: Row[] = [];
  candidates: Row[] = [];
  links: Row[] = [];
  private clock = 0;

  /**
   * Adds an import.
   *
   * @param id - The import.
   * @param exportedAt - When its export was taken.
   * @param rows - Its observations.
   * @param state - Its placement's state: only an active one is effective.
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

/**
 * The effective exports, as the replay would hand them over: those whose
 * placement is active, in export order, every one complete.
 *
 * @param tables - The tables.
 * @returns The snapshots.
 */
function snapshotsOf(tables: FakeTables): RosterIdentitySnapshot[] {
  return tables.imports
    .filter(record =>
      tables.placements.some(
        placement =>
          placement.subjectId === record.id &&
          placement.state === FileAssetPlacementState.ACTIVE,
      ),
    )
    .sort(
      (a, b) =>
        (a.exportedAt as Date).getTime() - (b.exportedAt as Date).getTime(),
    )
    .map(record => ({
      importId: record.id as string,
      exportedAt: record.exportedAt as Date,
      rows: (tables.observations.get(record.id as string) ??
        []) as unknown as RosterIdentitySnapshot['rows'],
      complete: true,
    }));
}

describe('RosterIdentityRecomputeService', () => {
  let tables: FakeTables;
  let service: RosterIdentityRecomputeService;

  /**
   * Recomputes the Fleet from the effective exports the tables hold.
   *
   * @returns What it did, in counts.
   */
  const recompute = async (): Promise<RosterIdentityRecomputeSummary> =>
    (
      await service.recomputeWithin(
        tables as unknown as EntityManager,
        FLEET_ID,
        snapshotsOf(tables),
      )
    ).summary;

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
    service = new RosterIdentityRecomputeService();
  });

  it('recomputes nothing from no exports', async () => {
    await expect(
      service.recomputeWithin(tables as unknown as EntityManager, FLEET_ID, []),
    ).resolves.toEqual({
      aliases: [],
      summary: {
        aliases: 0,
        inserted: 0,
        refreshed: 0,
        restaled: 0,
        deleted: 0,
        reassigned: 0,
      },
    });
  });

  // The replay builds the projection from these, so they have to be the
  // aliases as they stand after identities were reassigned.
  it('hands back every alias as stored once identities are assigned', async () => {
    tables.addImport('import-1', '2024-01-01T00:00:00Z', [
      observed('Kira', '@one'),
    ]);
    tables.addImport('import-2', '2024-02-01T00:00:00Z', [
      observed('Nerys', '@one'),
    ]);
    await recompute();
    tables.candidates[0].state = RosterIdentityCandidateState.CONFIRMED;

    const { aliases } = await service.recomputeWithin(
      tables as unknown as EntityManager,
      FLEET_ID,
      snapshotsOf(tables),
    );

    expect(aliases.map(each => each.identityId)).toEqual([
      alias('kira', '@one').identityId,
      alias('kira', '@one').identityId,
    ]);
  });

  describe('aliases', () => {
    it('gives a new alias an identity of its own', async () => {
      tables.addImport('import-1', '2024-01-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);

      await recompute();

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
      await recompute();
      const before = { ...alias('kira', '@one') };

      tables.addImport('import-2', '2024-02-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);
      await recompute();

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
      await recompute();
      tables.upsert.mockClear();

      await recompute();

      expect(tables.upsert).not.toHaveBeenCalled();
    });

    // Its import left force, but a decision may cite it, so the row stays.
    it('keeps an alias no effective export lists, with its dates cleared', async () => {
      tables.addImport('import-1', '2024-01-01T00:00:00Z', [
        observed('Kira', '@one'),
      ]);
      await recompute();

      tables.placements[0].state = FileAssetPlacementState.WITHDRAWN;
      await recompute();

      expect(alias('kira', '@one')).toMatchObject({
        firstObservedAt: null,
        lastObservedAt: null,
      });

      tables.update.mockClear();
      await recompute();

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

      await recompute();

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
      await expect(recompute()).resolves.toMatchObject({
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

      await recompute();

      expect(tables.candidates[0]).toMatchObject({
        kind: RosterIdentityCandidateKind.ACCOUNT_RENAME,
        fromAliasId: null,
        toAliasId: null,
        fromHandleNormalised: '@one',
        toHandleNormalised: '@two',
      });
    });

    it('rewrites an open one from the evidence, links and all', async () => {
      await recompute();
      const [first] = tables.candidates;

      tables.candidates[0].stale = true;
      tables.observations.set('import-2', [
        observed('Nerys', '@one', { level: 50 }),
      ]);

      await expect(recompute()).resolves.toMatchObject({
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
      await recompute();

      tables.addImport('import-between', '2024-01-15T00:00:00Z', []);

      await expect(recompute()).resolves.toMatchObject({
        deleted: 1,
      });
      expect(tables.candidates).toEqual([]);
      expect(tables.links).toEqual([]);
    });

    it('keeps a decided one the evidence no longer suggests, flagged', async () => {
      await recompute();
      Object.assign(tables.candidates[0], {
        state: RosterIdentityCandidateState.REJECTED,
        revision: 1,
      });

      tables.addImport('import-between', '2024-01-15T00:00:00Z', []);

      await expect(recompute()).resolves.toMatchObject({
        restaled: 1,
      });
      expect(tables.candidates[0]).toMatchObject({
        state: RosterIdentityCandidateState.REJECTED,
        stale: true,
      });

      tables.imports = tables.imports.filter(
        each => each.id !== 'import-between',
      );

      await recompute();

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
      await recompute();
    });

    it('leaves each alias its own identity while nothing is confirmed', () => {
      expect(alias('nerys', '@one').identityId).toBe(
        alias('nerys', '@one').originIdentityId,
      );
    });

    it('joins a confirmed rename into the identity seen first', async () => {
      tables.candidates[0].state = RosterIdentityCandidateState.CONFIRMED;

      await expect(recompute()).resolves.toMatchObject({
        reassigned: 1,
      });
      expect(alias('nerys', '@one').identityId).toBe(
        alias('kira', '@one').identityId,
      );
    });

    it('separates them again once the confirmation is undone', async () => {
      tables.candidates[0].state = RosterIdentityCandidateState.CONFIRMED;
      await recompute();

      tables.candidates[0].state = RosterIdentityCandidateState.OPEN;
      await recompute();

      expect(alias('nerys', '@one').identityId).toBe(
        alias('nerys', '@one').originIdentityId,
      );
    });
  });
});
