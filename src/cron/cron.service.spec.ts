import { Test, TestingModule } from '@nestjs/testing';
import { CronService } from './cron.service';
import { AuditCleanupService } from './jobs/audit-cleanup/audit-cleanup.service';
import { AuditLoginAttemptCleanupService } from './jobs/audit-login-attempt-cleanup/audit-login-attempt-cleanup.service';

describe('CronService', () => {
  let service: CronService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronService,
        { provide: AuditCleanupService, useValue: { cleanup: jest.fn() } },
        {
          provide: AuditLoginAttemptCleanupService,
          useValue: { cleanup: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<CronService>(CronService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
