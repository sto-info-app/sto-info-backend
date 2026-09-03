import { DataSource } from 'typeorm';

import { getTypeOrmConfig } from './typeorm.config';

export const connectionSourcePromise = getTypeOrmConfig().then(
  config => new DataSource(config),
);
