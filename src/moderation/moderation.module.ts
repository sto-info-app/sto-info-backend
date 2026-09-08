import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CommunityModule } from '../community/community.module';
import { UserRefreshTokenModule } from '../user-refresh-token/user-refresh-token.module';
import { UserEntity } from '../user/entities/user.entity';
import { UserReportEntity } from './entities/user-report.entity';
import { ModerationAdminController } from './moderation-admin.controller';
import { ModerationController } from './moderation.controller';
import { ReportService } from './report.service';
import { UserModerationService } from './user-moderation.service';

/**
 * Member reports and the administrator actions that answer them.
 *
 * Depends on community for {@link PublicMemberService} — a report names a
 * member the same way a block does, by profile username — and on the refresh
 * token module so disabling an account can end its live sessions. The
 * dependency runs one way only: community knows nothing about moderation.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([UserReportEntity, UserEntity]),
    CommunityModule,
    UserRefreshTokenModule,
  ],
  controllers: [ModerationController, ModerationAdminController],
  providers: [ReportService, UserModerationService],
  exports: [ReportService, UserModerationService],
})
export class ModerationModule {}
