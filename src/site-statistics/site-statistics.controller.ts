import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserRole } from 'src/user/enums/user-role.enum';

import { SiteStatisticsDto } from './site-statistics.dto';
import { SiteStatisticsService } from './site-statistics.service';

/**
 * The Site Statistics page's numbers (FC-053): counts of users, activity,
 * Storytime content, Fleet Communities, STO records, news and open reports.
 *
 * For the ADMIN role alone. Nothing here names anybody, so reading it is not
 * logged as a site admin action.
 */
@ApiTags('Site statistics (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
@Controller('admin/site-statistics')
export class SiteStatisticsController {
  /**
   * Creates an instance of SiteStatisticsController.
   *
   * @param _statistics - The statistics.
   */
  constructor(private readonly _statistics: SiteStatisticsService) {}

  /**
   * Every statistic the page shows, as of now.
   *
   * @returns The statistics.
   */
  @Get()
  @ApiOperation({ summary: 'Read the site statistics (admin)' })
  @ApiOkResponse({ type: SiteStatisticsDto })
  read(): Promise<SiteStatisticsDto> {
    return this._statistics.read();
  }
}
