import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateRosterProjection1794400000000 } from '../../../database/migrations/1794400000000-CreateRosterProjection';
import { RosterChangeKind } from '../enums/roster-change-kind.enum';
import { RosterEpisodeEnd } from '../enums/roster-episode-end.enum';
import { RosterEpisodeStart } from '../enums/roster-episode-start.enum';
import { RosterProjectionInputOutcome } from '../enums/roster-projection-input-outcome.enum';
import { RosterChangeEntity } from './roster-change.entity';
import { RosterEpisodeEntity } from './roster-episode.entity';
import { RosterIntervalSummaryEntity } from './roster-interval-summary.entity';
import { RosterProjectionInputEntity } from './roster-projection-input.entity';
import { RosterProjectionEntity } from './roster-projection.entity';

/**
 * Runs a migration step and keeps every statement it issues.
 *
 * @param step - The step to run.
 * @returns What it sent to the database, in order.
 */
async function capture(
  step: (queryRunner: QueryRunner) => Promise<void>,
): Promise<string[]> {
  const captured: string[] = [];
  const queryRunner = {
    query: jest.fn((sql: string) => {
      captured.push(sql);

      return Promise.resolve();
    }),
  } as unknown as QueryRunner;

  await step(queryRunner);

  return captured;
}

/**
 * Holds the five projection entities and their hand-written migration to
 * each other, as the roster import alignment specs do for theirs. It proves
 * the two descriptions agree, not that PostgreSQL accepts either: the
 * constraints were rehearsed against the local database.
 */
describe('Roster projection schema alignment', () => {
  const migration = new CreateRosterProjection1794400000000();
  let statements: string[];

  beforeAll(async () => {
    statements = await capture(queryRunner => migration.up(queryRunner));
  });

  const createTable = (table: string): string => {
    const found = statements.find(statement =>
      statement.includes(`CREATE TABLE "sto_info_app"."${table}" (`),
    );

    if (found === undefined) {
      throw new Error(`Migration does not create ${table}`);
    }

    return found;
  };

  const sqlLines = (table: string): string[] =>
    createTable(table)
      .split('\n')
      .map(line => line.trim());

  const tables: Array<[string, abstract new () => unknown]> = [
    ['fleet_roster_projection', RosterProjectionEntity],
    ['fleet_roster_projection_input', RosterProjectionInputEntity],
    ['fleet_roster_episode', RosterEpisodeEntity],
    ['fleet_roster_change', RosterChangeEntity],
    ['fleet_roster_interval_summary', RosterIntervalSummaryEntity],
  ];

  describe.each(tables)('%s', (table, entity) => {
    const declared = () =>
      getMetadataArgsStorage().columns.filter(
        column => column.target === entity,
      );

    it('declares exactly the columns the migration creates', () => {
      const migrationColumns = sqlLines(table)
        .filter(line => line.startsWith('"'))
        .map(line => line.slice(1, line.indexOf('"', 1)));

      expect([...migrationColumns].sort()).toEqual(
        declared()
          .map(column => column.options.name ?? column.propertyName)
          .sort(),
      );
    });

    // ADR-0007 from the other side: the entity has to ask for timestamptz.
    it('types every instant column as timestamptz in both places', () => {
      const instants = declared()
        .filter(column => column.options.type === 'timestamptz')
        .map(column => column.propertyName);

      expect(instants.length).toBeGreaterThan(0);

      for (const column of instants) {
        expect(sqlLines(table)).toContainEqual(
          expect.stringMatching(
            new RegExp(`^"${column}" timestamptz(?![a-z])`),
          ),
        );
      }
    });
  });

  it.each([
    ['roster_projection_input_outcome_enum', RosterProjectionInputOutcome],
    ['roster_episode_start_enum', RosterEpisodeStart],
    ['roster_episode_end_enum', RosterEpisodeEnd],
    ['roster_change_kind_enum', RosterChangeKind],
  ])('gives %s exactly the values the code knows', (type, values) => {
    const listed = Object.values(values)
      .map(value => `'${value}'`)
      .join(', ');

    expect(statements).toContainEqual(
      `CREATE TYPE "sto_info_app"."${type}" AS ENUM (${listed})`,
    );
  });

  it('never lets built pass requested, or a revision stand unpublished', () => {
    expect(createTable('fleet_roster_projection')).toContain(
      'CHECK ("built" >= 0 AND "built" <= "requested" AND "revision" >= 0)',
    );
    expect(createTable('fleet_roster_projection')).toContain(
      'CHECK (("revision" = 0) = ("publishedAt" IS NULL))',
    );
  });

  it('allows a contribution delta only as a rise', () => {
    expect(createTable('fleet_roster_change')).toContain(
      `CHECK (("kind" = 'CONTRIBUTION_CHANGED') = ("contributionDelta" IS NOT NULL) AND ("contributionDelta" IS NULL OR "contributionDelta" > 0))`,
    );
    expect(createTable('fleet_roster_interval_summary')).toContain(
      '"contributionDelta" >= 0',
    );
  });

  it('keeps every derived row inside its Fleet and revision by key', () => {
    expect(createTable('fleet_roster_episode')).toContain(
      'FOREIGN KEY ("identityId", "fleetId") REFERENCES "sto_info_app"."fleet_roster_identity"("id", "fleetId")',
    );
    expect(createTable('fleet_roster_change')).toContain(
      'FOREIGN KEY ("fleetId", "revision", "identityId", "episodeOrdinal") REFERENCES "sto_info_app"."fleet_roster_episode"("fleetId", "revision", "identityId", "ordinal")',
    );
  });

  // A CHECK comparing a nullable column passes when it is NULL, so the
  // LEFT-only rule compares with IS NOT DISTINCT FROM, which never yields it.
  it('names the export an episode ended before only for a departure', () => {
    expect(createTable('fleet_roster_episode')).toContain(
      `("endKind" IS NOT DISTINCT FROM 'LEFT') = ("endedBeforeImportId" IS NOT NULL)`,
    );
  });

  it('finds a Fleet whose projection is behind without a scan', () => {
    const index = getMetadataArgsStorage().indices.find(
      candidate => candidate.name === 'IDX_roster_projection_behind',
    );

    expect(index).toEqual(
      expect.objectContaining({
        target: RosterProjectionEntity,
        where: `"built" < "requested"`,
      }),
    );
    expect(statements).toContainEqual(
      `CREATE INDEX "IDX_roster_projection_behind" ON "sto_info_app"."fleet_roster_projection" ("fleetId") WHERE "built" < "requested"`,
    );
  });

  it('drops everything it created when reverted', async () => {
    const reverted = (
      await capture(queryRunner => migration.down(queryRunner))
    ).join('\n');

    for (const [table] of tables) {
      expect(reverted).toContain(`DROP TABLE "sto_info_app"."${table}"`);
    }

    for (const type of [
      'roster_projection_input_outcome_enum',
      'roster_episode_start_enum',
      'roster_episode_end_enum',
      'roster_change_kind_enum',
    ]) {
      expect(reverted).toContain(`DROP TYPE "sto_info_app"."${type}"`);
    }
  });
});
