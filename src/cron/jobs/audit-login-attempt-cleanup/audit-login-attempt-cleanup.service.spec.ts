import { Test, TestingModule } from '@nestjs/testing';
import { AuditLoginAttemptCleanupService } from './audit-login-attempt-cleanup.service';

describe('AuditLoginAttemptCleanupService', () => {
  let service: AuditLoginAttemptCleanupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditLoginAttemptCleanupService],
    }).compile();

    service = module.get<AuditLoginAttemptCleanupService>(
      AuditLoginAttemptCleanupService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
