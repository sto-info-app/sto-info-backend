import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { ContactRequestEntity } from 'src/contact/entities/contact-request.entity';

import { ContactRequestCleanupService } from './contact-request-cleanup.service';

describe('ContactRequestCleanupService', () => {
  let service: ContactRequestCleanupService;
  let repository: Repository<ContactRequestEntity>;
  let loggerLogSpy: jest.SpiedFunction<(...args: any[]) => any>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactRequestCleanupService,
        {
          provide: getRepositoryToken(ContactRequestEntity),
          useValue: {
            delete: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ContactRequestCleanupService>(
      ContactRequestCleanupService,
    );
    repository = module.get<Repository<ContactRequestEntity>>(
      getRepositoryToken(ContactRequestEntity),
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
    it('should clear masked email addresses older than retention', async () => {
      const deleteResult = { affected: 2 };
      const updateResult = { affected: 4 };
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
        expect.stringContaining('Deleted 2 contact requests'),
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cleared 4 masked contact emails'),
      );
    });

    it('should handle case with no records to update', async () => {
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
        expect.stringContaining('Deleted 0 contact requests'),
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cleared 0 masked contact emails'),
      );
    });
  });
});
