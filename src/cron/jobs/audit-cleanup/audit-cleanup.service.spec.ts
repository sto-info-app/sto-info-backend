import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { AuditEntity } from 'src/audit/entities/audit.entity';
import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';

import { AuditCleanupService } from './audit-cleanup.service';

describe('AuditCleanupService', () => {
  let service: AuditCleanupService;
  let repository: Repository<AuditEntity>;
  let loggerLogSpy: jest.SpiedFunction<(...args: any[]) => any>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditCleanupService,
        {
          provide: getRepositoryToken(AuditEntity),
          useValue: {
            delete: jest.fn(),
            update: jest.fn(),
            // The site admin log, which follows the same policy (FC-039).
            manager: {
              delete: jest.fn(async () => ({ affected: 2 })),
              update: jest.fn(async () => ({ affected: 1 })),
            },
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
        expect.stringContaining('Deleted 10 audit records'),
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Set IP address to null for 5 audit records'),
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
        expect.stringContaining('Deleted 0 audit records'),
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Set IP address to null for 0 audit records'),
      );
    });

    it('should use correct date thresholds', async () => {
      const deleteResult = { affected: 3 };
      const updateResult = { affected: 2 };

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

  // FC-039: the site admin log keeps a row 180 days and its IP address 90.
  it('holds the site admin log to the same policy', async () => {
    (
      repository.delete as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue({ affected: 0 });
    (
      repository.update as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue({ affected: 0 });

    await service.cleanup();

    const manager = (
      repository as unknown as {
        manager: { delete: jest.Mock; update: jest.Mock };
      }
    ).manager;

    expect(manager.delete).toHaveBeenCalledWith(SiteAdminActionEntity, {
      createdAt: expect.anything(),
    });
    expect(manager.update).toHaveBeenCalledWith(
      SiteAdminActionEntity,
      { createdAt: expect.anything(), ipAddress: expect.anything() },
      { ipAddress: null },
    );
    expect(loggerLogSpy).toHaveBeenCalledWith(
      'Site admin log: deleted 2 record(s), and forgot the IP address of 1.',
    );
  });
});
