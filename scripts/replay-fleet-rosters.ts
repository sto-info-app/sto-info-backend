/**
 * Asks for a roster replay of every Fleet with an import in force.
 *
 * FC-018 recomputed a Fleet's identities whenever one of its imports went
 * into force, and FC-019 replaces that with a replay that also builds the
 * Fleet's history, so a Fleet imported before FC-019 was deployed has no
 * projection until its next import. Run this once after deploying it, as
 * Steve chose on 24 September 2026 for the identity backfill it replaces.
 *
 * For each Fleet it records a request, bumping the Fleet's `requested`
 * counter, and then queues a job. Both are needed: a job that found no
 * request outstanding would build nothing. The running backend's workers do
 * the replays, one Fleet at a time under each Fleet's lock, so running this
 * twice, or while imports are arriving, costs a wasted pass and nothing
 * else.
 *
 * It does not boot the application. A script that did would start its queue
 * workers too, and they would take the jobs this has just queued inside a
 * process about to exit. It connects to the database and the queue and
 * nothing more.
 *
 * Prints one line of JSON: how many Fleets were queued, or with `--dry-run`
 * how many would have been.
 *
 * Usage: npm run fleet:replay-rosters [-- --dry-run]
 */

import { BullModule } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { getTypeOrmConfig } from '../config/typeorm.config';
import { ROSTER_REPLAY_QUEUE } from '../src/fleet/projection/constants/roster-replay.constants';
import { RosterReplayQueueService } from '../src/fleet/projection/services/roster-replay-queue.service';
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
    BullModule.registerQueue({ name: ROSTER_REPLAY_QUEUE }),
  ],
  providers: [RosterReplayQueueService],
})
class ReplayModule {}

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
  const app = await NestFactory.createApplicationContext(ReplayModule, {
    logger: ['error', 'warn'],
  });

  try {
    const fleets = await fleetsWithImportsInForce(app.get(DataSource));

    if (!dryRun) {
      const dataSource = app.get(DataSource);
      const replays = app.get(RosterReplayQueueService);

      for (const fleetId of fleets) {
        await dataSource.transaction(manager =>
          replays.request(manager, fleetId),
        );
        await replays.enqueue(fleetId);
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
  new Logger('ReplayFleetRosters').error(
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
