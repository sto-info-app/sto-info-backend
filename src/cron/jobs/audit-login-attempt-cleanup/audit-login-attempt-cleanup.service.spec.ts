import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLoginAttemptEntity } from 'src/audit/entities/audit-login-attempt.entity';
import { AuditLoginAttemptCleanupService } from './audit-login-attempt-cleanup.service';

describe('AuditLoginAttemptCleanupService', () => {
  let service: AuditLoginAttemptCleanupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLoginAttemptCleanupService,
        {
          provide: getRepositoryToken(AuditLoginAttemptEntity),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<AuditLoginAttemptCleanupService>(
      AuditLoginAttemptCleanupService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
