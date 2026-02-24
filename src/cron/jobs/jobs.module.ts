import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLoginAttemptEntity } from 'src/audit/entities/audit-login-attempt.entity';
import { AuditEntity } from 'src/audit/entities/audit.entity';
import { ContactRequestEntity } from 'src/contact/entities/contact-request.entity';
import { SesEventEntity } from 'src/webhooks/ses/entities/ses-event.entity';
import { CronService } from '../cron.service';
import { AuditCleanupService } from './audit-cleanup/audit-cleanup.service';
import { AuditLoginAttemptCleanupService } from './audit-login-attempt-cleanup/audit-login-attempt-cleanup.service';
import { ContactRequestCleanupService } from './contact-request-cleanup/contact-request-cleanup.service';
import { SesAuditCleanupService } from './ses-audit-cleanup/ses-audit-cleanup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditEntity,
      AuditLoginAttemptEntity,
      ContactRequestEntity,
      SesEventEntity,
    ]),
  ],
  providers: [
    CronService,

    // Job services
    AuditCleanupService,
    AuditLoginAttemptCleanupService,
    ContactRequestCleanupService,
    SesAuditCleanupService,
  ],
})
export class JobsModule {}
