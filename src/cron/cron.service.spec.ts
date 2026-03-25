import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { CronService } from './cron.service';
import { AuditCleanupService } from './jobs/audit-cleanup/audit-cleanup.service';
import { AuditLoginAttemptCleanupService } from './jobs/audit-login-attempt-cleanup/audit-login-attempt-cleanup.service';
import { ContactRequestCleanupService } from './jobs/contact-request-cleanup/contact-request-cleanup.service';
import { SesAuditCleanupService } from './jobs/ses-audit-cleanup/ses-audit-cleanup.service';

describe('CronService', () => {
  let service: CronService;
  let auditCleanupService: AuditCleanupService;
  let auditLoginAttemptCleanupService: AuditLoginAttemptCleanupService;
  let contactRequestCleanupService: ContactRequestCleanupService;
  let sesAuditCleanupService: SesAuditCleanupService;
  let loggerLogSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    const cleanupAuditMock: jest.MockedFunction<
      AuditCleanupService['cleanup']
    > = jest.fn();
    const cleanupLoginAttemptMock: jest.MockedFunction<
      AuditLoginAttemptCleanupService['cleanup']
    > = jest.fn();
    const cleanupContactRequestMock: jest.MockedFunction<
      ContactRequestCleanupService['cleanup']
    > = jest.fn();
    const cleanupSesAuditMock: jest.MockedFunction<
      SesAuditCleanupService['cleanup']
    > = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronService,
        {
          provide: AuditCleanupService,
          useValue: {
            cleanup: cleanupAuditMock,
          } satisfies Pick<AuditCleanupService, 'cleanup'>,
        },
        {
          provide: AuditLoginAttemptCleanupService,
          useValue: {
            cleanup: cleanupLoginAttemptMock,
          } satisfies Pick<AuditLoginAttemptCleanupService, 'cleanup'>,
        },
        {
          provide: ContactRequestCleanupService,
          useValue: {
            cleanup: cleanupContactRequestMock,
          } satisfies Pick<ContactRequestCleanupService, 'cleanup'>,
        },
        {
          provide: SesAuditCleanupService,
          useValue: {
            cleanup: cleanupSesAuditMock,
          } satisfies Pick<SesAuditCleanupService, 'cleanup'>,
        },
      ],
    }).compile();

    service = module.get<CronService>(CronService);
    auditCleanupService = module.get<AuditCleanupService>(AuditCleanupService);
    auditLoginAttemptCleanupService =
      module.get<AuditLoginAttemptCleanupService>(
        AuditLoginAttemptCleanupService,
      );
    contactRequestCleanupService = module.get<ContactRequestCleanupService>(
      ContactRequestCleanupService,
    );
    sesAuditCleanupService = module.get<SesAuditCleanupService>(
      SesAuditCleanupService,
    );

    loggerLogSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerLogSpy.mockRestore();
    loggerErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('dailyMidnightJobs', () => {
    it('should run all cleanup jobs successfully', async () => {
      jest.spyOn(auditCleanupService, 'cleanup').mockResolvedValue(undefined);
      jest
        .spyOn(auditLoginAttemptCleanupService, 'cleanup')
        .mockResolvedValue(undefined);
      jest
        .spyOn(contactRequestCleanupService, 'cleanup')
        .mockResolvedValue(undefined);
      jest
        .spyOn(sesAuditCleanupService, 'cleanup')
        .mockResolvedValue(undefined);

      await service.dailyMidnightJobs();

      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Running daily midnight jobs...',
      );
      expect(auditCleanupService.cleanup).toHaveBeenCalled();
      expect(auditLoginAttemptCleanupService.cleanup).toHaveBeenCalled();
      expect(contactRequestCleanupService.cleanup).toHaveBeenCalled();
      expect(sesAuditCleanupService.cleanup).toHaveBeenCalled();
    });

    it('should handle errors inside audit cleanup job', async () => {
      const error = new Error('Cleanup failed');
      jest.spyOn(auditCleanupService, 'cleanup').mockRejectedValue(error);
      jest
        .spyOn(auditLoginAttemptCleanupService, 'cleanup')
        .mockResolvedValue(undefined);
      jest
        .spyOn(contactRequestCleanupService, 'cleanup')
        .mockResolvedValue(undefined);
      jest
        .spyOn(sesAuditCleanupService, 'cleanup')
        .mockResolvedValue(undefined);

      await service.dailyMidnightJobs();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error running audit cleanup job:',
        error,
      );
    });

    it('should catch unexpected errors from within the job handlers', async () => {
      jest.spyOn(auditCleanupService, 'cleanup').mockResolvedValue(undefined);
      jest
        .spyOn(auditLoginAttemptCleanupService, 'cleanup')
        .mockResolvedValue(undefined);
      jest
        .spyOn(contactRequestCleanupService, 'cleanup')
        .mockResolvedValue(undefined);
      jest
        .spyOn(sesAuditCleanupService, 'cleanup')
        .mockResolvedValue(undefined);

      const logger = (service as unknown as { logger: Logger }).logger;
      const logSpy = jest
        .spyOn(logger, 'log')
        .mockImplementation((message: unknown) => {
          if (message === 'Starting audit cleanup job...') {
            throw new Error('Unexpected logger failure');
          }
        });

      await service.dailyMidnightJobs();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error running daily midnight jobs:',
        expect.any(Error),
      );

      logSpy.mockRestore();
    });
  });

  describe('handleAuditCleanup', () => {
    it('should run audit cleanup successfully', async () => {
      jest.spyOn(auditCleanupService, 'cleanup').mockResolvedValue(undefined);

      const instance = service as unknown as {
        handleAuditCleanup: () => Promise<void>;
      };
      await instance.handleAuditCleanup();

      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Starting audit cleanup job...',
      );
      expect(auditCleanupService.cleanup).toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Audit cleanup job completed successfully.',
      );
    });

    it('should handle audit cleanup errors', async () => {
      const error = new Error('Audit cleanup error');
      jest.spyOn(auditCleanupService, 'cleanup').mockRejectedValue(error);

      const instance = service as unknown as {
        handleAuditCleanup: () => Promise<void>;
      };
      await instance.handleAuditCleanup();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error running audit cleanup job:',
        error,
      );
    });
  });

  describe('handleAuditLoginAttemptCleanup', () => {
    it('should run audit login attempt cleanup successfully', async () => {
      jest
        .spyOn(auditLoginAttemptCleanupService, 'cleanup')
        .mockResolvedValue(undefined);

      const instance = service as unknown as {
        handleAuditLoginAttemptCleanup: () => Promise<void>;
      };
      await instance.handleAuditLoginAttemptCleanup();

      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Starting audit login attempt cleanup job...',
      );
      expect(auditLoginAttemptCleanupService.cleanup).toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Audit login attempt cleanup job completed successfully.',
      );
    });

    it('should handle audit login attempt cleanup errors', async () => {
      const error = new Error('Login attempt cleanup error');
      jest
        .spyOn(auditLoginAttemptCleanupService, 'cleanup')
        .mockRejectedValue(error);

      const instance = service as unknown as {
        handleAuditLoginAttemptCleanup: () => Promise<void>;
      };
      await instance.handleAuditLoginAttemptCleanup();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error running audit login attempt cleanup job:',
        error,
      );
    });
  });

  describe('handleContactRequestCleanup', () => {
    it('should run contact request cleanup successfully', async () => {
      jest
        .spyOn(contactRequestCleanupService, 'cleanup')
        .mockResolvedValue(undefined);

      const instance = service as unknown as {
        handleContactRequestCleanup: () => Promise<void>;
      };
      await instance.handleContactRequestCleanup();

      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Starting contact request cleanup job...',
      );
      expect(contactRequestCleanupService.cleanup).toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Contact request cleanup job completed successfully.',
      );
    });

    it('should handle contact request cleanup errors', async () => {
      const error = new Error('Contact request cleanup error');
      jest
        .spyOn(contactRequestCleanupService, 'cleanup')
        .mockRejectedValue(error);

      const instance = service as unknown as {
        handleContactRequestCleanup: () => Promise<void>;
      };
      await instance.handleContactRequestCleanup();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error running contact request cleanup job:',
        error,
      );
    });
  });

  describe('handleSesAuditCleanup', () => {
    it('should run SES audit cleanup successfully', async () => {
      jest
        .spyOn(sesAuditCleanupService, 'cleanup')
        .mockResolvedValue(undefined);

      const instance = service as unknown as {
        handleSesAuditCleanup: () => Promise<void>;
      };
      await instance.handleSesAuditCleanup();

      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Starting SES audit cleanup job...',
      );
      expect(sesAuditCleanupService.cleanup).toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'SES audit cleanup job completed successfully.',
      );
    });

    it('should handle SES audit cleanup errors', async () => {
      const error = new Error('SES audit cleanup error');
      jest.spyOn(sesAuditCleanupService, 'cleanup').mockRejectedValue(error);

      const instance = service as unknown as {
        handleSesAuditCleanup: () => Promise<void>;
      };
      await instance.handleSesAuditCleanup();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error running SES audit cleanup job:',
        error,
      );
    });
  });
});
