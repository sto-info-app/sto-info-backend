import { Module } from '@nestjs/common';

import { FeatureSwitchesController } from './feature-switches.controller';
import { FeatureSwitchesService } from './feature-switches.service';

/**
 * The site features' master switches, thrown from the Admin page (FC-045).
 *
 * Exported so Storytime's own admin switch can write through the same path,
 * with the same reason and log entry.
 */
@Module({
  controllers: [FeatureSwitchesController],
  providers: [FeatureSwitchesService],
  exports: [FeatureSwitchesService],
})
export class FeatureSwitchesModule {}
