import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditEntity } from 'src/audit/entities/audit.entity';
import { AuditCleanupService } from './audit-cleanup.service';

describe('AuditCleanupService', () => {
  let service: AuditCleanupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditCleanupService,
        {
          provide: getRepositoryToken(AuditEntity),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<AuditCleanupService>(AuditCleanupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
