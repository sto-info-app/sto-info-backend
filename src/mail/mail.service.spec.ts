import { MailerService } from '@nestjs-modules/mailer';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as sgMail from '@sendgrid/mail';
import * as ejs from 'ejs';
import { convert as htmlToText } from 'html-to-text';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { EmailMessage, MailService } from './mail.service';

jest.mock('@sendgrid/mail');
jest.mock('@nestjs-modules/mailer');
jest.mock('ejs');
jest.mock('html-to-text');

describe('MailService', () => {
  let service: MailService;
  let mockSecretsService: SecretsService;
  let mockValidatorsService: ValidatorsService;
  let mockMailerService: MailerService;

  beforeEach(async () => {
    process.env.APP_TITLE = 'Test App';
    process.env.EMAIL_NOREPLY_SENDER = 'no-reply@test.local';
    process.env.APP_FRONTEND_URL = 'https://test.local';
    process.env.AWS_SECRET_NAME = 'test-secret';
    process.env.AWS_SES_CONFIGURATION_SET = 'test-config-set';

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
        {
          provide: MailerService,
          useValue: {
            sendMail: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
    mockSecretsService = module.get<SecretsService>(SecretsService);
    mockValidatorsService = module.get<ValidatorsService>(ValidatorsService);
    mockMailerService = module.get<MailerService>(MailerService);

    // Mock ejs.renderFile and htmlToText
    (ejs.renderFile as jest.Mock).mockResolvedValue(
      '<html><body>Test</body></html>',
    );
    (htmlToText as jest.Mock).mockReturnValue('Test text');
  });

  afterEach(() => {
    delete process.env.AWS_SES_CONFIGURATION_SET;
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
    it('should send email successfully via SES', async () => {
      await service.sendVerificationEmail('test@example.com', 'token');
      expect(mockMailerService.sendMail).toHaveBeenCalled();
    });

    it('should throw if email format is invalid', async () => {
      (mockValidatorsService.validateEmail as jest.Mock).mockReturnValue(false);
      await expect(
        service.sendVerificationEmail('invalid', 'token'),
      ).rejects.toThrow('Invalid email format');
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('should send email successfully via SES', async () => {
      await service.sendPasswordResetEmail('test@example.com', 'token', 'John');
      expect(mockMailerService.sendMail).toHaveBeenCalled();
    });

    it('should throw if email format is invalid', async () => {
      (mockValidatorsService.validateEmail as jest.Mock).mockReturnValue(false);
      await expect(
        service.sendPasswordResetEmail('invalid', 'token', 'John'),
      ).rejects.toThrow('Invalid email format');
    });
  });

  describe('sendPasswordChangedEmail', () => {
    it('should send email successfully via SES', async () => {
      await service.sendPasswordChangedEmail('test@example.com', 'John');
      expect(mockMailerService.sendMail).toHaveBeenCalled();
    });
  });

  describe('sendUserLoggedInNotification', () => {
    it('should send email successfully via SES', async () => {
      await service.sendUserLoggedInNotification('test@example.com', 'John');
      expect(mockMailerService.sendMail).toHaveBeenCalled();
    });
  });

  describe('sendEmailToUser', () => {
    it('should send generic email successfully via SES', async () => {
      await service.sendEmailToUser('test@example.com', 'Sub', 'Text', 'Html');
      expect(mockMailerService.sendMail).toHaveBeenCalled();
    });
  });

  describe('sendEmailWithFallback', () => {
    const sampleMessage: EmailMessage = {
      to: 'test@example.com',
      from: { name: 'Test App', email: 'no-reply@test.local' },
      subject: 'Test Subject',
      text: 'Test text',
      html: '<html>Test html</html>',
    };

    it('should send via SES when it succeeds', async () => {
      await service.sendEmailWithFallback(sampleMessage);
      expect(mockMailerService.sendMail).toHaveBeenCalledTimes(1);
      expect(sgMail.send).not.toHaveBeenCalled();
    });

    it('should fall back to SendGrid when SES fails', async () => {
      (mockMailerService.sendMail as jest.Mock).mockRejectedValue(
        new Error('SES error'),
      );
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await service.sendEmailWithFallback(sampleMessage);

      expect(warnSpy).toHaveBeenCalled();
      expect(sgMail.send).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should log SendGrid errors when both SES and SendGrid fail', async () => {
      (mockMailerService.sendMail as jest.Mock).mockRejectedValue(
        new Error('SES error'),
      );
      const sendGridError = {
        response: { body: { errors: ['SendGrid error'] } },
      };
      (sgMail.send as jest.Mock).mockRejectedValue(sendGridError);
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await service.sendEmailWithFallback(sampleMessage);

      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(['SendGrid error']);
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should fall back to SendGrid and stringify non-Error sesError', async () => {
      // Exercises the `String(sesError)` branch (sesError is not an instance of Error)
      (mockMailerService.sendMail as jest.Mock).mockRejectedValue(
        'plain string error',
      );
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await service.sendEmailWithFallback(sampleMessage);

      expect(warnSpy).toHaveBeenCalledWith(
        'Amazon SES sending failed — falling back to SendGrid.',
        'plain string error',
      );
      expect(sgMail.send).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('sendEmailViaSES', () => {
    it('should omit ConfigurationSetName when AWS_SES_CONFIGURATION_SET is not set', async () => {
      delete process.env.AWS_SES_CONFIGURATION_SET;
      const message: EmailMessage = {
        to: 'test@example.com',
        from: { name: 'Test App', email: 'no-reply@test.local' },
        subject: 'Test Subject',
        text: 'Test text',
        html: '<html>Test html</html>',
      };

      await service.sendEmailViaSES(message);

      expect(mockMailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          ses: { ConfigurationSetName: undefined },
        }),
      );
    });

    it('should call mailerService.sendMail with correct parameters', async () => {
      const message: EmailMessage = {
        to: 'test@example.com',
        from: { name: 'Test App', email: 'no-reply@test.local' },
        subject: 'Test Subject',
        text: 'Test text',
        html: '<html>Test html</html>',
      };

      await service.sendEmailViaSES(message);

      expect(mockMailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          from: '"Test App" <no-reply@test.local>',
          subject: 'Test Subject',
          text: 'Test text',
          html: '<html>Test html</html>',
          ses: expect.objectContaining({
            ConfigurationSetName: 'test-config-set',
          }),
        }),
      );
    });

    it('should include replyTo header when replyTo is provided', async () => {
      const message: EmailMessage = {
        to: 'test@example.com',
        from: { name: 'Test App', email: 'no-reply@test.local' },
        subject: 'Test Subject',
        text: 'Test text',
        html: '<html>Test html</html>',
        replyTo: { email: 'support@test.local', name: 'Support' },
      };

      await service.sendEmailViaSES(message);

      expect(mockMailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          replyTo: '"Support" <support@test.local>',
        }),
      );
    });

    it('should handle replyTo without a name', async () => {
      const message: EmailMessage = {
        to: 'test@example.com',
        from: { name: 'Test App', email: 'no-reply@test.local' },
        subject: 'Test Subject',
        text: 'Test text',
        html: '<html>Test html</html>',
        replyTo: { email: 'support@test.local' },
      };

      await service.sendEmailViaSES(message);

      expect(mockMailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          replyTo: '"" <support@test.local>',
        }),
      );
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

  describe('toSendGridMessage', () => {
    it('should convert an EmailMessage to a SendGrid MailDataRequired object', () => {
      const message: EmailMessage = {
        to: 'test@example.com',
        from: { name: 'Test App', email: 'no-reply@test.local' },
        subject: 'Test Subject',
        text: 'Test text',
        html: '<html>Test html</html>',
      };

      const result = service.toSendGridMessage(message);

      expect(result).toEqual({
        to: 'test@example.com',
        from: { name: 'Test App', email: 'no-reply@test.local' },
        subject: 'Test Subject',
        text: 'Test text',
        html: '<html>Test html</html>',
      });
    });

    it('should include replyTo when provided', () => {
      const message: EmailMessage = {
        to: 'test@example.com',
        from: { name: 'Test App', email: 'no-reply@test.local' },
        subject: 'Test Subject',
        text: 'Test text',
        html: '<html>Test html</html>',
        replyTo: { email: 'reply@test.local', name: 'Reply' },
      };

      const result = service.toSendGridMessage(message);

      expect(result).toMatchObject({
        replyTo: { email: 'reply@test.local', name: 'Reply' },
      });
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

    it('should append environment to subject when NODE_ENV is not prod', () => {
      process.env.NODE_ENV = 'development';
      const result = service.generateEmailMessageObject(
        'test@example.com',
        'Test Subject',
        'text',
        'html',
      );
      expect(result.subject).toBe('Test Subject [development]');
    });

    it('should not append environment to subject when NODE_ENV is prod', () => {
      process.env.NODE_ENV = 'prod';
      const result = service.generateEmailMessageObject(
        'test@example.com',
        'Test Subject',
        'text',
        'html',
      );
      expect(result.subject).toBe('Test Subject');
    });

    it('should return correct message object structure', () => {
      const result = service.generateEmailMessageObject(
        'test@example.com',
        'Test Subject',
        'Test text',
        '<html>Test html</html>',
      );
      expect(result).toHaveProperty('to', 'test@example.com');
      expect(result).toHaveProperty('from');
      expect(result.from).toHaveProperty('name', 'Test App');
      expect(result.from).toHaveProperty('email', 'no-reply@test.local');
      expect(result).toHaveProperty('subject');
      expect(result).toHaveProperty('text', 'Test text');
      expect(result).toHaveProperty('html', '<html>Test html</html>');
    });
  });

  describe('validateEnvironmentVariables', () => {
    it.each([
      'APP_TITLE',
      'EMAIL_NOREPLY_SENDER',
      'APP_FRONTEND_URL',
      'AWS_SECRET_NAME',
      'AWS_SES_CONFIGURATION_SET',
    ])('should throw if %s is missing', envVar => {
      const original = process.env[envVar];
      delete process.env[envVar];
      expect(() => {
        const _s = new MailService(
          mockSecretsService,
          mockValidatorsService,
          mockMailerService,
        );
        return _s;
      }).toThrow(`Environment variable ${envVar} is not set`);
      process.env[envVar] = original;
    });
  });
});
