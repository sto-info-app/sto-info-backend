import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { StorytimeImageService } from './storytime-image.service';

/**
 * Storytime's artwork handling.
 *
 * Deliberately one module rather than a service per area. Every slot is
 * checked, stored and released the same way, and the differences between a
 * Story banner and a Character portrait are data in the slot table rather than
 * code — so five copies of this would be five places for the rules to drift.
 */
@Module({
  imports: [SharedModule],
  providers: [StorytimeImageService],
  exports: [StorytimeImageService],
})
export class StorytimeImagesModule {}
