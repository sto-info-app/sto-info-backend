import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { AuditLoginAttemptEntity } from 'src/audit/entities/audit-login-attempt.entity';

import { AuditLoginAttemptCleanupService } from './audit-login-attempt-cleanup.service';

describe('AuditLoginAttemptCleanupService', () => {
  let service: AuditLoginAttemptCleanupService;
  let repository: Repository<AuditLoginAttemptEntity>;
  let loggerLogSpy: jest.SpiedFunction<(...args: any[]) => any>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLoginAttemptCleanupService,
        {
          provide: getRepositoryToken(AuditLoginAttemptEntity),
          useValue: {
            delete: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuditLoginAttemptCleanupService>(
      AuditLoginAttemptCleanupService,
    );
    repository = module.get<Repository<AuditLoginAttemptEntity>>(
      getRepositoryToken(AuditLoginAttemptEntity),
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
    it('should delete old login attempt records and anonymize IP addresses', async () => {
      const deleteResult = { affected: 15 };
      const updateResult = { affected: 8 };

      (
        repository.delete as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(deleteResult);
      (
        repository.update as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(updateResult);

      await service.cleanup();

      expect(repository.delete).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deleted 15 audit login attempt records'),
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Set IP address to null for 8 audit login attempt records',
        ),
      );
    });

    it('should handle case with no records to delete', async () => {
      const deleteResult = { affected: 0 };
      const updateResult = { affected: 0 };

      (
        repository.delete as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(deleteResult);
      (
        repository.update as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(updateResult);

      await service.cleanup();

      expect(repository.delete).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deleted 0 audit login attempt records'),
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Set IP address to null for 0 audit login attempt records',
        ),
      );
    });

    it('should use correct date thresholds', async () => {
      const deleteResult = { affected: 5 };
      const updateResult = { affected: 3 };

      (
        repository.delete as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(deleteResult);
      (
        repository.update as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(updateResult);

      await service.cleanup();

      const deleteCall = (
        repository.delete as jest.Mock<(...args: any[]) => any>
      ).mock.calls[0][0];
      const updateCall = (
        repository.update as jest.Mock<(...args: any[]) => any>
      ).mock.calls[0][0];

      expect(deleteCall.createdAt).toBeDefined();
      expect(updateCall.createdAt).toBeDefined();
    });
  });
});
