import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { DataSource, DataSourceOptions } from 'typeorm';

dotenvConfig({ path: '.env' });

export async function getTypeOrmConfig(secretsService: SecretsService) {
  const secretObject = await secretsService.getSecret(
    process.env.AWS_SECRET_NAME,
  );

  const config: DataSourceOptions = {
    type: 'postgres',
    host: `${process.env.DB_HOST}`,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: `${process.env.DB_USERNAME}`,
    password: `${secretObject.dbPassword}`, // Use the dbPassword from AWS Secrets Manager
    database: `${process.env.DB_NAME}`,
    schema: `${process.env.DB_SCHEMA}`,
    entities: [__dirname + '/../**/*.entity.{js,ts}'],
    migrations: [join(__dirname, process.env.TYPEORM_MIGRATIONS)],
    synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true',
    logging: process.env.TYPEORM_LOGGING === 'true',
  };

  return {
    typeOrm: config,
    connectionSource: new DataSource(config as DataSourceOptions),
  };
}
