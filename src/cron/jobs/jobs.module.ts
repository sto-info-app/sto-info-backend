import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLoginAttemptEntity } from 'src/audit/entities/audit-login-attempt.entity';
import { AuditEntity } from 'src/audit/entities/audit.entity';
import { ContactRequestEntity } from 'src/contact/entities/contact-request.entity';
import { CronService } from '../cron.service';
import { AuditCleanupService } from './audit-cleanup/audit-cleanup.service';
import { AuditLoginAttemptCleanupService } from './audit-login-attempt-cleanup/audit-login-attempt-cleanup.service';
import { ContactRequestCleanupService } from './contact-request-cleanup/contact-request-cleanup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditEntity,
      AuditLoginAttemptEntity,
      ContactRequestEntity,
    ]),
  ],
  providers: [
    CronService,

    // Job services
    AuditCleanupService,
    AuditLoginAttemptCleanupService,
    ContactRequestCleanupService,
  ],
})
export class JobsModule {}
