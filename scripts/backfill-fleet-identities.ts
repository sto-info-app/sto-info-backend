/**
 * Queues a roster identity recompute for every Fleet with an import in force.
 *
 * FC-018 recomputes a Fleet's identities whenever one of its imports goes
 * into force, so a Fleet imported before FC-018 was deployed has none until
 * its next import. Run this once after deploying it; Steve chose on 24
 * September 2026 to do this by hand rather than on every start.
 *
 * It only queues. The running backend's workers do the recomputes, one Fleet
 * at a time under each Fleet's lock, so running it twice, or while imports are
 * arriving, costs a wasted pass and nothing else.
 *
 * It does not boot the application. A script that did would start its queue
 * workers too, and they would take the jobs this has just queued inside a
 * process about to exit. It connects to the database and the queue and
 * nothing more.
 *
 * Prints one line of JSON: how many Fleets were queued, or with `--dry-run`
 * how many would have been.
 *
 * Usage: npm run fleet:backfill-identities [-- --dry-run]
 */

import { BullModule } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { getTypeOrmConfig } from '../config/typeorm.config';
import { ROSTER_IDENTITY_QUEUE } from '../src/fleet/identity/constants/roster-identity.constants';
import { RosterIdentityQueueService } from '../src/fleet/identity/services/roster-identity-queue.service';
import { QueueModule } from '../src/shared/queue/queue.module';

const SCHEMA = process.env.DB_SCHEMA ?? 'sto_info_app';

/** The database, the queue, and the one service that writes to it. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `config/environments/${process.env.NODE_ENV || ''}.env`,
    }),
    TypeOrmModule.forRootAsync({ useFactory: getTypeOrmConfig }),
    QueueModule,
    BullModule.registerQueue({ name: ROSTER_IDENTITY_QUEUE }),
  ],
  providers: [RosterIdentityQueueService],
})
class BackfillModule {}

/**
 * Finds every Fleet with at least one import in force.
 *
 * @param dataSource - The connection.
 * @returns Their identifiers, in a stable order.
 */
async function fleetsWithImportsInForce(
  dataSource: DataSource,
): Promise<string[]> {
  const rows: Array<{ fleetId: string }> = await dataSource.query(
    `SELECT DISTINCT i."fleetId"
       FROM "${SCHEMA}"."fleet_roster_import_source" i
       JOIN "${SCHEMA}"."file_asset_placement" p
         ON p."subject" = 'ROSTER_IMPORT'
        AND p."subjectId" = i."id"::text
        AND p."state" = 'ACTIVE'
      ORDER BY i."fleetId"`,
  );

  return rows.map(row => row.fleetId);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['error', 'warn'],
  });

  try {
    const fleets = await fleetsWithImportsInForce(app.get(DataSource));

    if (!dryRun) {
      const queue = app.get(RosterIdentityQueueService);

      for (const fleetId of fleets) {
        await queue.enqueue(fleetId);
      }
    }

    process.stdout.write(
      `${JSON.stringify(dryRun ? { wouldQueue: fleets.length } : { queued: fleets.length })}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('BackfillFleetIdentities').error(
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
