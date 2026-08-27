import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CRON_TIMEZONE } from '../../cron/constants/cron.constants';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeChapterService } from './storytime-chapter.service';

/**
 * Publishes Chapters whose scheduled time has arrived.
 *
 * Deliberately not part of the nightly `CronService`. That runs once a day,
 * which would mean a Chapter scheduled for nine in the morning sat unpublished
 * until midnight. Running every five minutes bounds the delay to something a
 * creator would accept, at a cost of one indexed query per interval.
 *
 * The job lives with the Chapters it publishes rather than in the shared jobs
 * module, so that module does not have to depend on Storytime.
 */
@Injectable()
export class StorytimeChapterSchedulerService {
  private readonly _logger = new Logger(StorytimeChapterSchedulerService.name);

  /**
   * Creates an instance of StorytimeChapterSchedulerService.
   *
   * @param _chapterService - Publishes the Chapters that are due.
   * @param _featureService - Reports whether Storytime is switched on.
   */
  constructor(
    private readonly _chapterService: StorytimeChapterService,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Publishes any Chapter whose scheduled time has passed.
   *
   * Skipped entirely while Storytime is switched off, so an environment with
   * the feature disabled never publishes anything — including after an
   * administrator has pulled the switch during an incident.
   *
   * Errors are caught here as well as per Chapter, because an unhandled
   * rejection inside a scheduled job takes the process down.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { timeZone: CRON_TIMEZONE })
  async publishDueChapters(): Promise<void> {
    try {
      const isEnabled = await this._featureService.isFlagEnabled(
        STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
      );

      if (!isEnabled) {
        return;
      }

      await this._chapterService.publishDueChapters();
    } catch (error) {
      this._logger.error(
        'Scheduled Chapter publication failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
