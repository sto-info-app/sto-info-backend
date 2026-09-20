import { Injectable, Logger } from '@nestjs/common';

import { StaleUploadSweepService } from 'src/file-assets/services/stale-upload-sweep.service';

/**
 * The nightly half of FC-012: uploads nothing ever came back for.
 *
 * Thin, like the other jobs here. What counts as stale, what happens to the
 * bytes and what the placement becomes all belong to the registry and live
 * in {@link StaleUploadSweepService}; this exists so that the schedule is in
 * one file with the other nightly work rather than scattered across the
 * features that need it.
 */
@Injectable()
export class FileAssetUploadCleanupService {
  private readonly _logger = new Logger(FileAssetUploadCleanupService.name);

  /**
   * Creates an instance of FileAssetUploadCleanupService.
   *
   * @param _sweep - What gives up on a stale upload.
   */
  constructor(private readonly _sweep: StaleUploadSweepService) {}

  /**
   * Abandons uploads that have been waiting for a verdict too long.
   */
  async cleanup(): Promise<void> {
    const report = await this._sweep.sweep();

    this._logger.log(
      `Abandoned ${report.abandoned} stale upload(s); ` +
        `${report.undeleted} left bytes in quarantine.`,
    );
  }
}
