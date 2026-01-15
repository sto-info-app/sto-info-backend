import { config as dotenvConfig } from 'dotenv';
import { join } from 'node:path';
import { AuditEntity } from 'src/audit/entities/audit.entity';
import { AuditSubscriber } from 'src/audit/subscribers/audit.subscriber';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { DataSourceOptions } from 'typeorm';

dotenvConfig({ path: './config/environments/.env' });

const secretsService = new SecretsService();

function getDbType(): 'postgres' {
  const dbType = (process.env.DB_TYPE ?? 'postgres').toLowerCase();

  // This project currently supports Postgres only.
  // If you add support for other providers, extend this guard and the config validation.
  if (dbType !== 'postgres') {
    throw new Error(`Unsupported DB_TYPE: ${dbType}`);
  }

  return 'postgres';
}

export async function getTypeOrmConfig(): Promise<DataSourceOptions> {
  const secretObject = await secretsService.getSecret(
    process.env.AWS_SECRET_NAME,
  );

  const isLocalEnv = process.env.NODE_ENV === 'local';

  const rootDir = join(__dirname, '../');
  const entitiesDir = join(rootDir, process.env.TYPEORM_ENTITIES);
  const migrationDir = join(rootDir, process.env.TYPEORM_MIGRATIONS);

  return {
    type: getDbType(),
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USERNAME,
    password: secretObject.dbPassword, // Use the dbPassword from AWS Secrets Manager
    database: process.env.DB_NAME,
    schema: process.env.DB_SCHEMA,
    entities: [entitiesDir, AuditEntity],
    subscribers: [AuditSubscriber],
    migrations: [migrationDir],
    migrationsTableName: '_migrations',
    synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true',
    logging: process.env.TYPEORM_LOGGING === 'true',
    ssl: isLocalEnv
      ? false
      : {
          rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
        },
  };
}
