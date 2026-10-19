import { Global, Module } from '@nestjs/common';

import { STO_RECORD_DELETION } from 'src/sto/shared/sto-record-deletion';

import { CustomTrackingModule } from './custom-tracking.module';
import { CustomTrackingRecordDeletionService } from './images/custom-tracking-record-deletion.service';

/**
 * Offers Custom Tracking's part in deleting an STO Account or Character to
 * the STO and user modules, which cannot import Custom Tracking without a
 * cycle.
 */
@Global()
@Module({
  imports: [CustomTrackingModule],
  providers: [
    {
      provide: STO_RECORD_DELETION,
      useExisting: CustomTrackingRecordDeletionService,
    },
  ],
  exports: [STO_RECORD_DELETION],
})
export class CustomTrackingRecordDeletionModule {}
