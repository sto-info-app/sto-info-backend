import { DataSource, DataSourceOptions } from 'typeorm';

import { getTypeOrmConfig } from './typeorm.config';

/** A bare SQL identifier: what a schema name is allowed to be here. */
const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;

/**
 * Creates the configured schema if it is absent.
 *
 * TypeORM writes its migrations table before it reads a single migration,
 * and that table lives in `DB_SCHEMA`. So the migration that creates the
 * schema cannot be the thing that creates it: against an empty database the
 * runner fails with `3F000 schema "sto_info_app" does not exist` before any
 * migration is considered, and fails again on every retry.
 *
 * The migration rehearsal cannot catch this. It applies a migration's SQL
 * directly rather than through TypeORM, so it exercises the migration and
 * not the runner that has to go first.
 *
 * `CREATE SCHEMA IF NOT EXISTS` stays in `1739748306217-Initial` as well.
 * This is the bootstrap; that is still the statement of ownership, and it is
 * what the rehearsal proves.
 *
 * @param options - The datasource this runs ahead of.
 * @throws Error when `DB_SCHEMA` is not a bare identifier.
 */
async function ensureSchemaExists(options: DataSourceOptions): Promise<void> {
  const schema = (options as { schema?: string }).schema;

  // No schema means the connection's default, which always exists.
  if (schema === undefined || schema === '') {
    return;
  }

  // Unlike the worker's, this name comes from the environment rather than
  // from a constant, and it is about to be concatenated into DDL that no
  // driver will parameterise. Anything but a bare identifier is refused
  // rather than quoted and hoped for.
  if (!SCHEMA_NAME_PATTERN.test(schema)) {
    throw new Error(
      `DB_SCHEMA must be a bare identifier matching ${String(SCHEMA_NAME_PATTERN)}, received: ${schema}`,
    );
  }

  // Without a schema of its own, and with nothing to load: this connection
  // exists to run one statement, and pointing it at the schema it is about
  // to create would defeat the purpose.
  //
  // DataSourceOptions is a union across every driver, and spreading one
  // widens it until `schema` belongs to none of them. getTypeOrmConfig
  // refuses anything but postgres, so the shape is known.
  const bootstrap = new DataSource({
    ...options,
    schema: undefined,
    entities: [],
    subscribers: [],
    migrations: [],
  } as DataSourceOptions);

  await bootstrap.initialize();

  try {
    await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  } finally {
    await bootstrap.destroy();
  }
}

export const connectionSourcePromise = getTypeOrmConfig().then(async config => {
  await ensureSchemaExists(config);

  return new DataSource(config);
});
