import { Test, TestingModule } from '@nestjs/testing';
import { AuditCleanupService } from './audit-cleanup.service';

describe('AuditCleanupService', () => {
  let service: AuditCleanupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditCleanupService],
    }).compile();

    service = module.get<AuditCleanupService>(AuditCleanupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
