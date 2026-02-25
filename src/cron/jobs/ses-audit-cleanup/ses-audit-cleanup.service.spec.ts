import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SesEventEntity } from 'src/webhooks/ses/entities/ses-event.entity';
import { Repository } from 'typeorm';
import { SesAuditCleanupService } from './ses-audit-cleanup.service';

type MockRepo = jest.Mocked<Pick<Repository<SesEventEntity>, 'delete'>>;

describe('SesAuditCleanupService', () => {
  let service: SesAuditCleanupService;
  let repository: MockRepo;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(async () => {
    repository = {
      delete: jest.fn().mockResolvedValue({ affected: 0, raw: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SesAuditCleanupService,
        {
          provide: getRepositoryToken(SesEventEntity),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get(SesAuditCleanupService);
    loggerLogSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerLogSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cleanup', () => {
    it('should delete non-suppressing and suppressing records in order', async () => {
      repository.delete
        .mockResolvedValueOnce({ affected: 12, raw: [] }) // non-suppressing
        .mockResolvedValueOnce({ affected: 3, raw: [] }); // suppressing

      await service.cleanup();

      // Two deletions total — confirmed in order
      expect(repository.delete).toHaveBeenCalledTimes(2);

      const [firstCall, secondCall] = repository.delete.mock.calls as [
        [object],
        [object],
      ];
      expect(firstCall[0]).toMatchObject({ suppress: false });
      expect(secondCall[0]).toMatchObject({ suppress: true });
    });

    it('should log affected row counts for non-suppressing deletion', async () => {
      repository.delete
        .mockResolvedValueOnce({ affected: 7, raw: [] })
        .mockResolvedValueOnce({ affected: 0, raw: [] });

      await service.cleanup();

      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deleted 7 non-suppressing SES audit records'),
      );
    });

    it('should log affected row counts for suppression deletion', async () => {
      repository.delete
        .mockResolvedValueOnce({ affected: 0, raw: [] })
        .mockResolvedValueOnce({ affected: 2, raw: [] });

      await service.cleanup();

      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deleted 2 suppression SES audit records'),
      );
    });

    it('should handle undefined affected gracefully (logs 0)', async () => {
      repository.delete
        .mockResolvedValueOnce({ affected: undefined, raw: [] })
        .mockResolvedValueOnce({ affected: undefined, raw: [] });

      await service.cleanup();

      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deleted 0 non-suppressing SES audit records'),
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deleted 0 suppression SES audit records'),
      );
    });

    it('should pass a date threshold to each delete call', async () => {
      repository.delete
        .mockResolvedValueOnce({ affected: 0, raw: [] })
        .mockResolvedValueOnce({ affected: 0, raw: [] });

      await service.cleanup();

      const [firstArg, secondArg] = repository.delete.mock.calls as [
        [object],
        [object],
      ];
      // Each call should include a createdAt field (LessThan produces an object)
      expect(firstArg[0]).toHaveProperty('createdAt');
      expect(secondArg[0]).toHaveProperty('createdAt');
    });
  });
});
