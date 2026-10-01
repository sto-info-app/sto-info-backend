import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { recordSiteAdminAction } from 'src/audit/site-admin/site-admin-action.utility';
import { usernamesFor } from 'src/fleet/recruitment/utilities/recruitment-names.utility';
import { SettingsService } from 'src/settings/settings.service';
import { redisWithin } from 'src/shared/queue/redis-within.utility';

import {
  FILE_ASSET_PUBLICATION_QUEUE,
  FILE_PUBLICATION_PAUSED_SETTING_KEY,
} from '../constants/file-asset-publication.constants';
import { PublicationPauseDto } from './publication-pause.dto';

/** What the switch says. */
export interface PublicationPauseState {
  readonly paused: boolean;
  readonly pausedAt: Date | null;
  readonly pausedByUserId: string | null;
  /**
   * When it was last resumed, while it runs; null while paused, or when it
   * has not been resumed since it was seeded. The stale-upload sweep counts
   * its day from here.
   */
  readonly resumedAt: Date | null;
}

/**
 * Reads an instant the switch holds.
 *
 * @param value - The value.
 * @returns The instant, or null when it is missing or not one.
 */
function instantOf(value: unknown): Date | null {
  const instant = typeof value === 'string' ? new Date(value) : null;

  return instant === null || Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * The publication pause (FC-042): Steve's kill switch for everything a
 * scanner clears.
 *
 * While it is on, uploads are still accepted and scanned, and nothing is
 * published; when it is turned off, everything held publishes. Publication
 * only ever happens through `AssetPublicationProcessor` on the
 * `file-asset-publication` queue — pictures, restricted roster files and
 * every verdict the scanner clears all reach it through
 * `AssetPublicationQueueService` — so pausing that queue pauses exactly
 * that, and nothing else.
 *
 * - **The database is the authority.** The switch is an `app_setting` a
 *   site admin throws with a reason, logged in the site admin log. The
 *   queue is paused and resumed to match — at once, at startup, and on every
 *   minute's alert run — because Redis can be lost and a new Redis knows
 *   nothing of a pause.
 * - **Belt and braces.** The processor asks the switch before each job and
 *   puts the job back if it is on, so a queue that has not yet been brought
 *   into line publishes nothing either.
 * - **Independent of every feature switch.** The file gate is never governed
 *   by a feature switch, and neither is this.
 */
@Injectable()
export class PublicationPauseService implements OnApplicationBootstrap {
  private readonly _logger = new Logger(PublicationPauseService.name);

  /**
   * Creates an instance of PublicationPauseService.
   *
   * @param _dataSource - The database, for the switch and its log entry.
   * @param _settings - Where the switch is kept.
   * @param _queue - The publication queue.
   */
  constructor(
    @InjectDataSource() private readonly _dataSource: DataSource,
    private readonly _settings: SettingsService,
    @InjectQueue(FILE_ASSET_PUBLICATION_QUEUE) private readonly _queue: Queue,
  ) {}

  /**
   * Brings the queue into line with the switch as the application starts.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.apply('startup');
  }

  /**
   * What the switch says.
   *
   * A value that cannot be read counts as paused: only this service writes
   * it, so an unreadable one is a fault, and publishing through a fault is
   * the wrong way to fail. A missing switch counts as running, as it did
   * before there was one.
   *
   * @param fresh - True to read the database now, not the settings cache.
   * @returns The switch.
   */
  async state(fresh = false): Promise<PublicationPauseState> {
    const raw = await this._settings.getString(
      FILE_PUBLICATION_PAUSED_SETTING_KEY,
      fresh,
    );

    if (raw === null) {
      return {
        paused: false,
        pausedAt: null,
        pausedByUserId: null,
        resumedAt: null,
      };
    }

    let value: unknown;

    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }

    const record =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)
        : null;

    if (record?.paused === false) {
      return {
        paused: false,
        pausedAt: null,
        pausedByUserId: null,
        resumedAt: instantOf(record.resumedAt),
      };
    }

    if (record?.paused !== true) {
      this._logger.warn(
        `[state] Unreadable publication switch; treated as paused`,
      );
    }

    return {
      paused: true,
      pausedAt: instantOf(record?.pausedAt),
      pausedByUserId:
        typeof record?.pausedByUserId === 'string'
          ? record.pausedByUserId
          : null,
      resumedAt: null,
    };
  }

  /**
   * Whether publication is paused, from the settings cache: for the
   * processor, which asks before every job.
   *
   * @returns True while it is paused.
   */
  async isPaused(): Promise<boolean> {
    return (await this.state()).paused;
  }

  /**
   * The switch, who threw it by username, and the queue as it stands, for a
   * page.
   *
   * The queue's part waits at most {@link REDIS_TIMEOUT_MS} for Redis, and
   * is null when it does not answer: the page a site admin is sent to in a
   * Redis outage must not wait for Redis.
   *
   * @param queueReachable - False when the caller already knows Redis is not
   *   answering, so as not to wait for it twice.
   * @returns All three.
   */
  async read(queueReachable = true): Promise<PublicationPauseDto> {
    const { paused, pausedAt, pausedByUserId } = await this.state(true);
    const names = await usernamesFor(this._dataSource.manager, [
      pausedByUserId,
    ]);
    let queuePaused: boolean | null = null;
    let held: number | null = null;

    try {
      if (queueReachable) {
        [queuePaused, held] = await redisWithin(async () => {
          const isPaused = await this._queue.isPaused();
          const counts = await this._queue.getJobCounts(
            'waiting',
            'prioritized',
            'delayed',
          );

          return [
            isPaused,
            (counts.waiting ?? 0) +
              (counts.prioritized ?? 0) +
              (counts.delayed ?? 0),
          ] as const;
        });
      }
    } catch (error) {
      this.warn('read', error);
    }

    return {
      paused,
      pausedAt,
      pausedByUserId,
      // Null for an account since gone, as the Security Log names people.
      pausedByUsername:
        pausedByUserId === null ? null : (names.get(pausedByUserId) ?? null),
      queuePaused,
      held,
    };
  }

  /**
   * Pauses publication.
   *
   * @param adminUserId - The site admin.
   * @param reason - Why, for the site admin log.
   * @returns The switch and the queue.
   * @throws ConflictException when it is already paused.
   */
  async pause(
    adminUserId: string,
    reason: string,
  ): Promise<PublicationPauseDto> {
    if ((await this.state(true)).paused) {
      throw new ConflictException('Publication is already paused.');
    }

    const value = JSON.stringify({
      paused: true,
      pausedAt: new Date().toISOString(),
      pausedByUserId: adminUserId,
    });

    await this._dataSource.transaction(async manager => {
      await this._settings.setValue(
        FILE_PUBLICATION_PAUSED_SETTING_KEY,
        value,
        adminUserId,
        manager,
      );
      await recordSiteAdminAction(manager, {
        action: SiteAdminActionKind.PUBLICATION_PAUSED,
        actorUserId: adminUserId,
        reason,
      });
    });

    this._logger.warn(`[pause] Publication paused - AdminId: ${adminUserId}`);
    // The switch is written: publication is paused whatever Redis says. The
    // queue is paused now if Redis answers, and otherwise at the first
    // minute's run once it does; until then the processor puts back any job
    // it is handed.
    return this.read(await this.applyToQueue(true, 'pause'));
  }

  /**
   * Resumes publication: everything held publishes.
   *
   * @param adminUserId - The site admin.
   * @param reason - Why, for the site admin log.
   * @returns The switch and the queue.
   * @throws ConflictException when it is not paused.
   */
  async resume(
    adminUserId: string,
    reason: string,
  ): Promise<PublicationPauseDto> {
    const current = await this.state(true);

    if (!current.paused) {
      throw new ConflictException('Publication is not paused.');
    }

    await this._dataSource.transaction(async manager => {
      await this._settings.setValue(
        FILE_PUBLICATION_PAUSED_SETTING_KEY,
        JSON.stringify({ paused: false, resumedAt: new Date().toISOString() }),
        adminUserId,
        manager,
      );
      await recordSiteAdminAction(manager, {
        action: SiteAdminActionKind.PUBLICATION_RESUMED,
        actorUserId: adminUserId,
        reason,
        detail:
          current.pausedAt === null
            ? null
            : {
                pausedMinutes: Math.floor(
                  (Date.now() - current.pausedAt.getTime()) / 60_000,
                ),
              },
      });
    });

    this._logger.log(`[resume] Publication resumed - AdminId: ${adminUserId}`);
    return this.read(await this.applyToQueue(false, 'resume'));
  }

  /**
   * Brings the queue into line with the switch, reading the switch afresh.
   * Never throws: whoever calls it — startup, the alert run, the processor,
   * a site admin — carries on, and the next run tries again.
   *
   * @param trigger - Who asked, for the log.
   * @returns Whether publication is paused, or null when the switch could
   *   not be read.
   */
  async apply(trigger: string): Promise<boolean | null> {
    let paused: boolean;

    try {
      paused = (await this.state(true)).paused;
    } catch (error) {
      this.warn('apply', error);

      return null;
    }

    await this.applyToQueue(paused, trigger);

    return paused;
  }

  /**
   * Pauses or resumes the queue to match, waiting at most
   * {@link REDIS_TIMEOUT_MS} for Redis. Never throws.
   *
   * @param paused - What the switch says.
   * @param trigger - Who asked, for the log.
   * @returns Whether Redis answered.
   */
  private async applyToQueue(
    paused: boolean,
    trigger: string,
  ): Promise<boolean> {
    // A command Redis holds is still sent when it comes back. Once this has
    // given up, a late answer must not pause or resume on a switch that may
    // have changed since: the next alert run applies the switch as it is.
    let givenUp = false;

    try {
      await redisWithin(async () => {
        const queuePaused = await this._queue.isPaused();

        if (givenUp) {
          return;
        }

        if (paused && !queuePaused) {
          await this._queue.pause();
          this._logger.warn(
            `[apply] Publication queue paused to match the switch - Trigger: ${trigger}`,
          );
        } else if (!paused && queuePaused) {
          await this._queue.resume();
          this._logger.log(
            `[apply] Publication queue resumed to match the switch - Trigger: ${trigger}`,
          );
        }
      });

      return true;
    } catch (error) {
      givenUp = true;
      this.warn('apply', error);

      return false;
    }
  }

  /**
   * Logs a source that could not be reached, without its message, which can
   * name a host.
   *
   * @param source - The method that failed.
   * @param error - What it threw.
   */
  private warn(source: string, error: unknown): void {
    this._logger.warn(
      `[${source}] Source unavailable - Error: ` +
        (error instanceof Error ? error.name : typeof error),
    );
  }
}
