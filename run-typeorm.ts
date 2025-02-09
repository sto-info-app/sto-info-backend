import { exec } from 'child_process';
import { config as dotenvConfig } from 'dotenv';
import 'tsconfig-paths/register';
import { promisify } from 'util';
import { connectionSourcePromise } from './config/typeorm.datasource';

const execAsync = promisify(exec);

// Load environment variables from .env file
dotenvConfig({ path: './config/environments/.env' });

async function runTypeORMCommand() {
  const connectionSource = await connectionSourcePromise;
  await connectionSource.initialize();

  const args = process.argv.slice(2);
  const command = args[0] || '';
  const migrationName = args[2] || ''; //NOTE: args[1] is the migration name parameter key

  switch (command) {
    case 'migration:generate':
      if (!migrationName) {
        console.error('Migration name is required for migration:generate');
        process.exit(1);
      }
      await execAsync(
        `ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:generate ./src/database/migrations/${migrationName} -d ./config/typeorm.datasource.ts`,
      );
      break;
    case 'migration:run':
      await execAsync(
        `ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:run -d ./config/typeorm.datasource.ts`,
      );
      break;
    case 'migration:revert':
      await execAsync(
        `ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:revert -d ./config/typeorm.datasource.ts`,
      );
      break;
    case 'migration:show':
      await execAsync(
        `ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:show -d ./config/typeorm.datasource.ts`,
      );
      break;
    default:
      console.log(`Unknown command: ${command}`);
  }

  await connectionSource.destroy();
}

runTypeORMCommand().catch(error => {
  console.error('Error running TypeORM command:', error);
  process.exit(1);
});
