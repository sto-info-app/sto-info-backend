import { Module } from '@nestjs/common';

import { SiteStatisticsController } from './site-statistics.controller';
import { SiteStatisticsService } from './site-statistics.service';

/**
 * The Site Statistics page's numbers, for site administrators (FC-053).
 *
 * The service counts across many tables through the data source, so no
 * repositories are registered here.
 */
@Module({
  controllers: [SiteStatisticsController],
  providers: [SiteStatisticsService],
})
export class SiteStatisticsModule {}
