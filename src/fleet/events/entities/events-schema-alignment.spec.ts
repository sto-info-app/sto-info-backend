import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateScopeEvents1795700000000 } from '../../../database/migrations/1795700000000-CreateScopeEvents';
import { ScopeEventActionEntity } from './scope-event-action.entity';
import { ScopeEventAttendanceEntity } from './scope-event-attendance.entity';
import { ScopeEventAudienceMemberEntity } from './scope-event-audience-member.entity';
import { ScopeEventOccurrenceEntity } from './scope-event-occurrence.entity';
import { ScopeEventReminderEntity } from './scope-event-reminder.entity';
import { ScopeEventRsvpEntity } from './scope-event-rsvp.entity';
import { ScopeEventEntity } from './scope-event.entity';

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
 * Holds the event entities and their hand-written migration to each other
 * (FC-028). It proves the two descriptions agree, not that PostgreSQL
 * accepts either: the constraints and the trigger were rehearsed against the
 * local database.
 */
describe('Event schema alignment', () => {
  const migration = new CreateScopeEvents1795700000000();
  let statements: string[];
  let reverted: string[];

  beforeAll(async () => {
    statements = await capture(queryRunner => migration.up(queryRunner));
    reverted = await capture(queryRunner => migration.down(queryRunner));
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

  const declared = (entity: abstract new () => unknown) =>
    getMetadataArgsStorage().columns.filter(column => column.target === entity);

  const TABLES: [string, abstract new () => unknown][] = [
    ['scope_event', ScopeEventEntity],
    ['scope_event_audience_member', ScopeEventAudienceMemberEntity],
    ['scope_event_occurrence', ScopeEventOccurrenceEntity],
    ['scope_event_rsvp', ScopeEventRsvpEntity],
    ['scope_event_attendance', ScopeEventAttendanceEntity],
    ['scope_event_reminder', ScopeEventReminderEntity],
    ['scope_event_action', ScopeEventActionEntity],
  ];

  it.each(TABLES)(
    'declares exactly the columns %s is created with',
    (table, entity) => {
      const migrationColumns = sqlLines(table)
        .filter(line => line.startsWith('"'))
        .map(line => line.slice(1, line.indexOf('"', 1)));

      expect([...migrationColumns].sort()).toEqual(
        declared(entity)
          .map(column => column.options.name ?? column.propertyName)
          .sort(),
      );
    },
  );

  it.each(TABLES)(
    'types every instant column of %s as timestamptz in both places',
    (table, entity) => {
      const instants = getMetadataArgsStorage()
        .columns.filter(
          column =>
            column.target === entity && column.options.type === 'timestamptz',
        )
        .map(column => column.propertyName);

      for (const column of instants) {
        expect(sqlLines(table)).toContainEqual(
          expect.stringMatching(
            new RegExp(`^"${column}" timestamptz(?![a-z])`),
          ),
        );
      }
    },
  );

  it('starts a weekly rule’s weekdays empty, as the migration does', () => {
    const weekdays = declared(ScopeEventEntity).find(
      column => column.propertyName === 'weekdays',
    );

    expect((weekdays?.options.default as () => string)()).toBe("'{}'");
    expect(sqlLines('scope_event')).toContain(
      `"weekdays" smallint[] NOT NULL DEFAULT '{}',`,
    );
  });

  it('keeps one answer, one attendance and one reminder per person', () => {
    expect(createTable('scope_event_rsvp')).toContain(
      'CONSTRAINT "UQ_scope_event_rsvp_person" UNIQUE ("occurrenceId", "userId")',
    );
    expect(createTable('scope_event_attendance')).toContain(
      'CONSTRAINT "UQ_scope_event_attendance_person" UNIQUE ("occurrenceId", "userId")',
    );
    expect(createTable('scope_event_reminder')).toContain(
      'CONSTRAINT "UQ_scope_event_reminder_person" UNIQUE ("eventId", "userId")',
    );
  });

  it('lets only Going wait for a place', () => {
    expect(createTable('scope_event_rsvp')).toContain(
      `CHECK ("waitlistedAt" IS NULL OR "response" = 'GOING')`,
    );
  });

  it('keeps an occurrence per day its rule names', () => {
    expect(createTable('scope_event_occurrence')).toContain(
      'CONSTRAINT "UQ_scope_event_occurrence_key" UNIQUE ("eventId", "occurrenceKey")',
    );
  });

  it('keeps the change log write-once', () => {
    expect(statements).toContainEqual(
      expect.stringContaining(
        'CREATE TRIGGER "TR_scope_event_action_guard" BEFORE UPDATE',
      ),
    );
  });

  it('takes every table and type back out when reverted', () => {
    for (const [table] of TABLES) {
      expect(reverted).toContain(`DROP TABLE "sto_info_app"."${table}"`);
    }

    expect(reverted).toContain(
      'DROP TYPE "sto_info_app"."scope_event_audience_enum"',
    );
    expect(reverted[reverted.length - 1]).toBe(
      'DROP TYPE "sto_info_app"."scope_event_audience_enum"',
    );
  });
});
