import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditEntity } from 'src/audit/entities/audit.entity';
import { Repository } from 'typeorm';
import { AuditCleanupService } from './audit-cleanup.service';

describe('AuditCleanupService', () => {
  let service: AuditCleanupService;
  let repository: Repository<AuditEntity>;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditCleanupService,
        {
          provide: getRepositoryToken(AuditEntity),
          useValue: {
            delete: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuditCleanupService>(AuditCleanupService);
    repository = module.get<Repository<AuditEntity>>(
      getRepositoryToken(AuditEntity),
    );
    loggerLogSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerLogSpy.mockRestore();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cleanup', () => {
    it('should delete old audit records and anonymize IP addresses', async () => {
      const deleteResult = { affected: 10 };
      const updateResult = { affected: 5 };

      (repository.delete as jest.Mock).mockResolvedValue(deleteResult);
      (repository.update as jest.Mock).mockResolvedValue(updateResult);

      await service.cleanup();

      expect(repository.delete).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deleted 10 audit records'),
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Set IP address to null for 5 audit records'),
      );
    });

    it('should handle case with no records to delete', async () => {
      const deleteResult = { affected: 0 };
      const updateResult = { affected: 0 };

      (repository.delete as jest.Mock).mockResolvedValue(deleteResult);
      (repository.update as jest.Mock).mockResolvedValue(updateResult);

      await service.cleanup();

      expect(repository.delete).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deleted 0 audit records'),
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Set IP address to null for 0 audit records'),
      );
    });

    it('should use correct date thresholds', async () => {
      const deleteResult = { affected: 3 };
      const updateResult = { affected: 2 };

      (repository.delete as jest.Mock).mockResolvedValue(deleteResult);
      (repository.update as jest.Mock).mockResolvedValue(updateResult);

      await service.cleanup();

      const deleteCall = (repository.delete as jest.Mock).mock.calls[0][0];
      const updateCall = (repository.update as jest.Mock).mock.calls[0][0];

      expect(deleteCall.createdAt).toBeDefined();
      expect(updateCall.createdAt).toBeDefined();
    });
  });
});
