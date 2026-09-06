import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLoginAttemptEntity } from 'src/audit/entities/audit-login-attempt.entity';
import { AuditEntity } from 'src/audit/entities/audit.entity';
import { ContactRequestEntity } from 'src/contact/entities/contact-request.entity';
import { CustomTrackingModule } from 'src/custom-tracking/custom-tracking.module';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { UserRefreshTokenEntity } from 'src/user-refresh-token/entities/user-refresh-token.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { SesEventEntity } from 'src/webhooks/ses/entities/ses-event.entity';

import { CronService } from '../cron.service';
import { AuditCleanupService } from './audit-cleanup/audit-cleanup.service';
import { AuditLoginAttemptCleanupService } from './audit-login-attempt-cleanup/audit-login-attempt-cleanup.service';
import { ContactRequestCleanupService } from './contact-request-cleanup/contact-request-cleanup.service';
import { CustomTrackingCleanupService } from './custom-tracking-cleanup/custom-tracking-cleanup.service';
import { SesAuditCleanupService } from './ses-audit-cleanup/ses-audit-cleanup.service';
import { UserAccountCleanupService } from './user-account-cleanup/user-account-cleanup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditEntity,
      AuditLoginAttemptEntity,
      ContactRequestEntity,
      SesEventEntity,
      UserEntity,
      UserProfileEntity,
      UserRefreshTokenEntity,
      AccountEntity,
    ]),
    // For the retention sweep, and so closing an account takes the pictures
    // in Cloudflare with it rather than only the rows that referenced them.
    CustomTrackingModule,
  ],
  providers: [
    CronService,

    // Job services
    AuditCleanupService,
    AuditLoginAttemptCleanupService,
    ContactRequestCleanupService,
    SesAuditCleanupService,
    UserAccountCleanupService,
    CustomTrackingCleanupService,
  ],
})
export class JobsModule {}
