import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Raw, Repository } from 'typeorm';

import { CRON_TIMEZONE } from '../../../cron/constants/cron.constants';
import { RosterProjectionEntity } from '../entities/roster-projection.entity';
import { RosterReplayQueueService } from './roster-replay-queue.service';

/**
 * Queues a replay for every Fleet whose projection is behind (FC-019).
 *
 * A change records its request in its own transaction and queues the job
 * after committing, so a queue that is down at that moment leaves a request
 * nothing will act on. Steve chose on 25 September 2026 to catch that with a
 * sweep every ten minutes rather than leave the projection stale until the
 * next change.
 *
 * Queueing a Fleet whose replay is already on its way costs a job that reads
 * two numbers and stops, so the sweep does not try to tell the difference.
 */
@Injectable()
export class RosterReplaySweepService {
  private readonly _logger = new Logger(RosterReplaySweepService.name);

  /**
   * Creates an instance of RosterReplaySweepService.
   *
   * @param _projections - Repository of projection rows.
   * @param _queue - Queues a replay.
   */
  constructor(
    @InjectRepository(RosterProjectionEntity)
    private readonly _projections: Repository<RosterProjectionEntity>,
    private readonly _queue: RosterReplayQueueService,
  ) {}

  /**
   * Queues every Fleet whose projection is behind what was asked of it.
   *
   * Errors are caught, because an unhandled rejection inside a scheduled job
   * takes the process down; the next sweep tries again.
   *
   * @returns How many Fleets were queued, or null when the sweep failed.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { timeZone: CRON_TIMEZONE })
  async sweep(): Promise<number | null> {
    try {
      const behind = await this._projections.find({
        where: { built: Raw(built => `${built} < "requested"`) },
        select: { fleetId: true },
      });

      for (const { fleetId } of behind) {
        await this._queue.enqueue(fleetId);
      }

      if (behind.length > 0) {
        this._logger.warn(
          `[sweep] Roster projections behind, replays queued - ` +
            `Fleets: ${behind.length}`,
        );
      }

      return behind.length;
    } catch (error) {
      this._logger.error(
        'Roster replay sweep failed',
        error instanceof Error ? error.stack : String(error),
      );

      return null;
    }
  }
}
