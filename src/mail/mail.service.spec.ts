import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as sgMail from '@sendgrid/mail';
import * as ejs from 'ejs';
import { convert as htmlToText } from 'html-to-text';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { MailService } from './mail.service';

jest.mock('@sendgrid/mail');
jest.mock('ejs');
jest.mock('html-to-text');

describe('MailService', () => {
  let service: MailService;
  let mockSecretsService: SecretsService;
  let mockValidatorsService: ValidatorsService;

  beforeEach(async () => {
    process.env.APP_TITLE = 'Test App';
    process.env.SENDGRID_NOREPLY_SENDER = 'no-reply@test.local';
    process.env.APP_FRONTEND_URL = 'https://test.local';
    process.env.AWS_SECRET_NAME = 'test-secret';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: SecretsService,
          useValue: {
            getSecret: jest
              .fn()
              .mockResolvedValue({ sendGridApiKey: 'test-key' }),
          },
        },
        {
          provide: ValidatorsService,
          useValue: {
            validateEmail: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
    mockSecretsService = module.get<SecretsService>(SecretsService);
    mockValidatorsService = module.get<ValidatorsService>(ValidatorsService);

    // Mock ejs.renderFile and htmlToText
    (ejs.renderFile as jest.Mock).mockResolvedValue(
      '<html><body>Test</body></html>',
    );
    (htmlToText as jest.Mock).mockReturnValue('Test text');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should initialize correctly', async () => {
      await service.onModuleInit();
      expect(mockSecretsService.getSecret).toHaveBeenCalledWith('test-secret');
      expect(sgMail.setApiKey).toHaveBeenCalledWith('test-key');
    });
  });

  describe('sendVerificationEmail', () => {
    it('should send email successfully', async () => {
      await service.sendVerificationEmail('test@example.com', 'token');
      expect(sgMail.send).toHaveBeenCalled();
    });

    it('should throw if email format is invalid', async () => {
      (mockValidatorsService.validateEmail as jest.Mock).mockReturnValue(false);
      await expect(
        service.sendVerificationEmail('invalid', 'token'),
      ).rejects.toThrow('Invalid email format');
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('should send email successfully', async () => {
      await service.sendPasswordResetEmail('test@example.com', 'token', 'John');
      expect(sgMail.send).toHaveBeenCalled();
    });

    it('should throw if email format is invalid', async () => {
      (mockValidatorsService.validateEmail as jest.Mock).mockReturnValue(false);
      await expect(
        service.sendPasswordResetEmail('invalid', 'token', 'John'),
      ).rejects.toThrow('Invalid email format');
    });
  });

  describe('sendPasswordChangedEmail', () => {
    it('should send email successfully', async () => {
      await service.sendPasswordChangedEmail('test@example.com', 'John');
      expect(sgMail.send).toHaveBeenCalled();
    });
  });

  describe('sendUserLoggedInNotification', () => {
    it('should send email successfully', async () => {
      await service.sendUserLoggedInNotification('test@example.com', 'John');
      expect(sgMail.send).toHaveBeenCalled();
    });
  });

  describe('sendEmailToUser', () => {
    it('should send generic email successfully', async () => {
      await service.sendEmailToUser('test@example.com', 'Sub', 'Text', 'Html');
      expect(sgMail.send).toHaveBeenCalled();
    });
  });

  describe('sendEmailViaSendGrid', () => {
    it('should log error if sending fails with response errors', async () => {
      const error = { response: { body: { errors: ['SendGrid error'] } } };
      (sgMail.send as jest.Mock).mockRejectedValue(error);
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await service.sendEmailViaSendGrid({} as any);
      expect(loggerSpy).toHaveBeenCalledWith(['SendGrid error']);
      loggerSpy.mockRestore();
    });

    it('should log generic error if sending fails without response errors', async () => {
      const error = new Error('Generic error');
      (sgMail.send as jest.Mock).mockRejectedValue(error);
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await service.sendEmailViaSendGrid({} as any);
      expect(loggerSpy).toHaveBeenCalledWith(error);
      loggerSpy.mockRestore();
    });

    it('should log generic error if sending fails with partial response object', async () => {
      const error = { response: {} };
      (sgMail.send as jest.Mock).mockRejectedValue(error);
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await service.sendEmailViaSendGrid({} as any);
      expect(loggerSpy).toHaveBeenCalledWith(error);
      loggerSpy.mockRestore();
    });

    it('should log generic error if sending fails with partial response body object', async () => {
      const error = { response: { body: {} } };
      (sgMail.send as jest.Mock).mockRejectedValue(error);
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await service.sendEmailViaSendGrid({} as any);
      expect(loggerSpy).toHaveBeenCalledWith(error);
      loggerSpy.mockRestore();
    });

    it('should log generic error if sending fails with null error', async () => {
      (sgMail.send as jest.Mock).mockRejectedValue(null);
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await service.sendEmailViaSendGrid({} as any);
      expect(loggerSpy).toHaveBeenCalledWith(null);
      loggerSpy.mockRestore();
    });
  });

  describe('validateEmailFormat', () => {
    it('should return false if email is null', () => {
      expect(service.validateEmailFormat(null)).toBe(false);
    });
  });

  describe('generateEmailMessageObject', () => {
    it('should throw if to address is invalid', () => {
      (mockValidatorsService.validateEmail as jest.Mock).mockReturnValue(false);
      expect(() =>
        service.generateEmailMessageObject('invalid', 'sub', 'text', 'html'),
      ).toThrow('Invalid email format');
    });
  });

  describe('validateEnvironmentVariables', () => {
    it.each([
      'APP_TITLE',
      'SENDGRID_NOREPLY_SENDER',
      'APP_FRONTEND_URL',
      'AWS_SECRET_NAME',
    ])('should throw if %s is missing', envVar => {
      const original = process.env[envVar];
      delete process.env[envVar];
      expect(() => {
        new MailService(mockSecretsService, mockValidatorsService);
      }).toThrow(`Environment variable ${envVar} is not set`);
      process.env[envVar] = original;
    });
  });
});
