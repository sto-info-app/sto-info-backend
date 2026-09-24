import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateRosterObservation1793500000000 } from '../../../database/migrations/1793500000000-CreateRosterObservation';
import { RecordRosterImportCorrections1794300000000 } from '../../../database/migrations/1794300000000-RecordRosterImportCorrections';
import { RosterObservationEntity } from './roster-observation.entity';

/**
 * Holds the observation entity and its hand-written migration to each other.
 *
 * The migration is raw SQL, so nothing generates one from the other and
 * nothing notices when they part company. Same reasoning as
 * `roster-import-source-schema-alignment.spec.ts`, and the same limitation:
 * this proves the two descriptions agree, not that PostgreSQL accepts
 * either. That is what the migration rehearsal is for.
 */
describe('Roster observation schema alignment', () => {
  let statements: string[];

  beforeAll(async () => {
    const captured: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        captured.push(sql);

        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    // Every migration that shapes this table, in the order they run: FC-019
    // added the exclusion flag.
    await new CreateRosterObservation1793500000000().up(queryRunner);
    await new RecordRosterImportCorrections1794300000000().up(queryRunner);
    statements = captured;
  });

  const createTable = (): string => {
    const found = statements.find(statement =>
      statement.includes(
        'CREATE TABLE "sto_info_app"."fleet_roster_observation"',
      ),
    );

    if (found === undefined) {
      throw new Error('Migration does not create fleet_roster_observation');
    }

    return found;
  };

  const sqlLines = (): string[] =>
    createTable()
      .split('\n')
      .map(line => line.trim());

  const entityColumns = (): string[] =>
    getMetadataArgsStorage()
      .columns.filter(column => column.target === RosterObservationEntity)
      .map(column => column.options.name ?? column.propertyName);

  /** Every `ALTER TABLE … ADD "column"` this table's migrations run. */
  const addedColumns = (): string[] =>
    statements
      .map(statement =>
        /ALTER TABLE "sto_info_app"\."fleet_roster_observation" ADD "([^"]+)" /.exec(
          statement,
        ),
      )
      .filter(match => match !== null)
      .map(match => match[1]);

  const migrationColumns = (): string[] => [
    ...sqlLines()
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1))),
    ...addedColumns(),
  ];

  const guard = (): string => {
    const definitions = statements.filter(statement =>
      statement.includes('roster_observation_guard'),
    );

    return definitions[0];
  };

  it('declares exactly the columns the migration creates', () => {
    expect([...migrationColumns()].sort()).toEqual([...entityColumns()].sort());
  });

  // ADR-0007 from the other side: the entity has to ask for timestamptz too,
  // or TypeORM's default lands a plain timestamp in any generated migration.
  it('types every instant column as timestamptz in both places', () => {
    const declared = getMetadataArgsStorage()
      .columns.filter(column => column.target === RosterObservationEntity)
      .filter(column => column.options.type === 'timestamptz')
      .map(column => column.options.name ?? column.propertyName);

    expect(declared).toEqual(
      expect.arrayContaining([
        'joinedAt',
        'rankChangedAt',
        'lastActiveAt',
        'publicCommentEditedAt',
      ]),
    );

    for (const column of declared) {
      expect(sqlLines()).toContainEqual(
        expect.stringMatching(new RegExp(`^"${column}" timestamptz(?![a-z])`)),
      );
    }
  });

  /*
   * Every date is stored twice on purpose, and the pair is what makes a
   * wrong timezone correctable. A column added on one side of a pair and
   * forgotten on the other would leave an instant with nothing to re-read
   * it from, which is the failure this whole shape exists to prevent.
   */
  it('keeps a local text and an ambiguity flag beside every instant', () => {
    const columns = migrationColumns();
    const instants = columns.filter(
      column =>
        sqlLines().some(line => line.startsWith(`"${column}" timestamptz`)) &&
        column !== 'createdAt' &&
        column !== 'updatedAt',
    );

    expect(instants).toHaveLength(4);

    for (const instant of instants) {
      expect(columns).toContain(`${instant}Local`);
      expect(columns).toContain(`${instant}Ambiguous`);
    }
  });

  it('refuses an instant without the text it was read from', () => {
    // A CHECK comparing the two columns directly would pass whenever either
    // was NULL, which is precisely the case it has to catch. `IS NULL` on
    // both sides never yields NULL, so this one actually fires.
    for (const pair of [
      'joined_pair',
      'rank_changed_pair',
      'last_active_pair',
      'comment_edited_pair',
    ]) {
      expect(createTable()).toContain(
        `CONSTRAINT "CHK_roster_observation_${pair}" CHECK ((`,
      );
    }
  });

  it('keeps what was observed write-once in the database', () => {
    expect(guard()).toBeDefined();

    for (const column of [
      'importSourceId',
      'fleetId',
      'line',
      'characterName',
      'characterNameNormalised',
      'accountHandle',
      'accountHandleNormalised',
      'level',
      'className',
      'profession',
      'guildRank',
      'contributionTotal',
      'joinedAtLocal',
      'rankChangedAtLocal',
      'lastActiveAtLocal',
      'status',
      'publicComment',
      'publicCommentEditedAtLocal',
    ]) {
      expect(guard()).toContain(
        `NEW."${column}" IS DISTINCT FROM OLD."${column}"`,
      );
    }
  });

  /*
   * Correcting an export's timezone means re-reading every date it was
   * applied to. A trigger that froze the instants would make the local text
   * beside them pointless, because nothing would be able to act on a
   * re-reading of it.
   */
  it('leaves every interpreted instant correctable', () => {
    for (const column of [
      'joinedAt',
      'rankChangedAt',
      'lastActiveAt',
      'publicCommentEditedAt',
    ]) {
      expect(guard()).not.toContain(
        `NEW."${column}" IS DISTINCT FROM OLD."${column}"`,
      );
      expect(guard()).not.toContain(
        `NEW."${column}Ambiguous" IS DISTINCT FROM OLD."${column}Ambiguous"`,
      );
    }
  });

  // Excluding a row changes whether it counts, never what it said.
  it('leaves the exclusion flag changeable', () => {
    expect(addedColumns()).toEqual(['excluded']);
    expect(guard()).not.toContain('NEW."excluded" IS DISTINCT FROM');
  });

  it('drops everything it created when reverted', async () => {
    const captured: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        captured.push(sql);

        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    await new CreateRosterObservation1793500000000().down(queryRunner);

    const reverted = captured.join('\n');

    expect(reverted).toContain(
      'DROP TABLE "sto_info_app"."fleet_roster_observation"',
    );
    expect(reverted).toContain(
      'DROP TRIGGER IF EXISTS "TR_roster_observation_guard"',
    );
    expect(reverted).toContain(
      'DROP FUNCTION IF EXISTS "sto_info_app"."roster_observation_guard"',
    );
    expect(reverted).toContain(
      'DROP TYPE "sto_info_app"."roster_profession_enum"',
    );
  });
});
