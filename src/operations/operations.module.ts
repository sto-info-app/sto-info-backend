import { Module } from '@nestjs/common';

import { FileAssetsModule } from 'src/file-assets/file-assets.module';
import { FileScanningModule } from 'src/file-scanning/file-scanning.module';
import { NotificationModule } from 'src/notification/notification.module';

import { OperationsAlertService } from './alerts/operations-alert.service';
import { FailedJobsController } from './failed-jobs/failed-jobs.controller';
import { FailedJobsService } from './failed-jobs/failed-jobs.service';

/**
 * Running the file pipeline (FC-042): the operations alerts every site
 * admin is told of, and the failed jobs they can retry from Scan
 * Diagnostics.
 *
 * The queues whose failed jobs it shows belong to other modules and are
 * found through the module graph rather than registered again here, so it
 * opens no Redis connections of its own. Nothing imports it.
 */
@Module({
  imports: [FileScanningModule, FileAssetsModule, NotificationModule],
  controllers: [FailedJobsController],
  providers: [FailedJobsService, OperationsAlertService],
})
export class OperationsModule {}
