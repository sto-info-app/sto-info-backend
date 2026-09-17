import { writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/**
 * Writes out the SQL a migration would run, without touching a database.
 *
 * The migration is handed a query runner that records statements instead of
 * executing them, so this is exactly what TypeORM would send — not a
 * transcription of it. The two files it produces are then replayed against a
 * throwaway PostgreSQL container by `run-rehearsal.sh`.
 *
 * Usage:
 *   ts-node -r tsconfig-paths/register \
 *     scripts/migration-rehearsal/emit-migration-sql.ts \
 *     src/database/migrations/<migration>.ts <up.sql> <down.sql>
 */

interface Migration {
  up(queryRunner: unknown): Promise<void>;
  down(queryRunner: unknown): Promise<void>;
}

type MigrationConstructor = new () => Migration;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * Finds the single migration class a migration module exports.
 *
 * @param modulePath - Path to the migration file.
 * @returns The exported migration constructor.
 */
function loadMigration(modulePath: string): MigrationConstructor {
  const absolute = isAbsolute(modulePath)
    ? modulePath
    : resolve(process.cwd(), modulePath);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require(absolute) as Record<string, unknown>;
  const candidates = Object.values(loaded).filter(
    (value): value is MigrationConstructor =>
      typeof value === 'function' &&
      typeof (value as MigrationConstructor).prototype?.up === 'function',
  );

  if (candidates.length !== 1) {
    fail(
      `Expected exactly one migration class in ${modulePath}, found ${candidates.length}.`,
    );
  }

  return candidates[0];
}

/**
 * Runs one direction of a migration against a recording query runner.
 *
 * @param MigrationClass - The migration to run.
 * @param direction - Which direction to record.
 * @returns The statements the migration issued, in order.
 */
async function record(
  MigrationClass: MigrationConstructor,
  direction: 'up' | 'down',
): Promise<string[]> {
  const statements: string[] = [];
  const queryRunner = {
    query: (sql: string): Promise<void> => {
      statements.push(sql);

      return Promise.resolve();
    },
  };

  await new MigrationClass()[direction](queryRunner);

  return statements;
}

async function main(): Promise<void> {
  const [, , modulePath, upPath, downPath] = process.argv;

  if (!modulePath || !upPath || !downPath) {
    fail(
      'Usage: emit-migration-sql.ts <migration.ts> <out-up.sql> <out-down.sql>',
    );
  }

  const MigrationClass = loadMigration(modulePath);

  for (const [direction, target] of [
    ['up', upPath],
    ['down', downPath],
  ] as const) {
    const statements = await record(MigrationClass, direction);

    // Semicolon-separated, because psql needs terminators and TypeORM's
    // statements do not carry them.
    writeFileSync(target, `${statements.join(';\n')};\n`, 'utf8');
    process.stdout.write(
      `${direction}: ${statements.length} statements -> ${target}\n`,
    );
  }
}

void main();
