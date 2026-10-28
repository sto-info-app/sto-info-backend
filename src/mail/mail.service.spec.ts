import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';
import { MailerService } from '@nestjs-modules/mailer';
import * as ejs from 'ejs';
import { convert as htmlToText } from 'html-to-text';

import { ValidatorsService } from 'src/shared/utilities/validators.service';

import { EmailMessage, MailService } from './mail.service';

jest.mock('@nestjs-modules/mailer');
jest.mock('ejs');
jest.mock('html-to-text');

describe('MailService', () => {
  let service: MailService;
  let mockValidatorsService: ValidatorsService;
  let mockMailerService: MailerService;

  beforeEach(async () => {
    process.env.APP_TITLE = 'Test App';
    process.env.EMAIL_NOREPLY_SENDER = 'no-reply@test.local';
    process.env.APP_FRONTEND_URL = 'https://test.local';
    process.env.AWS_SES_CONFIGURATION_SET = 'test-config-set';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ValidatorsService,
          useValue: {
            validateEmail: jest.fn().mockReturnValue(true),
          },
        },
        {
          provide: MailerService,
          useValue: {
            sendMail: jest
              .fn<(...args: any[]) => Promise<any>>()
              .mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
    mockValidatorsService = module.get<ValidatorsService>(ValidatorsService);
    mockMailerService = module.get<MailerService>(MailerService);

    // Mock ejs.renderFile and htmlToText
    (
      ejs.renderFile as jest.Mock<(...args: any[]) => Promise<any>>
    ).mockResolvedValue('<html><body>Test</body></html>');
    (htmlToText as jest.Mock).mockReturnValue('Test text');
  });

  afterEach(() => {
    delete process.env.AWS_SES_CONFIGURATION_SET;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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

  describe('sendAccountClosureEmail', () => {
    it('should send email successfully via SES', async () => {
      await service.sendAccountClosureEmail('test@example.com', 'John');
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

  describe('sendEmail', () => {
    const sampleMessage: EmailMessage = {
      to: 'test@example.com',
      from: { name: 'Test App', email: 'no-reply@test.local' },
      subject: 'Test Subject',
      text: 'Test text',
      html: '<html>Test html</html>',
    };

    it('should send via SES', async () => {
      await service.sendEmail(sampleMessage);
      expect(mockMailerService.sendMail).toHaveBeenCalledTimes(1);
    });

    it('should log the SES failure rather than throw', async () => {
      (
        mockMailerService.sendMail as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(new Error('SES error'));
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(service.sendEmail(sampleMessage)).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        'Amazon SES sending failed.',
        'SES error',
      );
      errorSpy.mockRestore();
    });

    it('should log rejected recipients as an SES failure', async () => {
      (
        mockMailerService.sendMail as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        accepted: [],
        rejected: ['test@example.com'],
        response: '550 rejected',
      });
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await service.sendEmail(sampleMessage);

      expect(errorSpy).toHaveBeenCalledWith(
        'Amazon SES sending failed.',
        'SES rejected recipient(s): test@example.com',
      );
      errorSpy.mockRestore();
    });

    it('should stringify a non-Error SES failure', async () => {
      (
        mockMailerService.sendMail as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue('plain string error');
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await service.sendEmail(sampleMessage);

      expect(errorSpy).toHaveBeenCalledWith(
        'Amazon SES sending failed.',
        'plain string error',
      );
      errorSpy.mockRestore();
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
      (
        mockMailerService.sendMail as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({ accepted: ['test@example.com'], rejected: [] });

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

    it('should throw when SES reports rejected recipients', async () => {
      (
        mockMailerService.sendMail as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        accepted: [],
        rejected: ['test@example.com'],
      });

      await expect(
        service.sendEmailViaSES({
          to: 'test@example.com',
          from: { name: 'Test App', email: 'no-reply@test.local' },
          subject: 'Test Subject',
          text: 'Test text',
          html: '<html>Test html</html>',
        }),
      ).rejects.toThrow('SES rejected recipient(s): test@example.com');
    });

    it('should throw when SES leaves recipients pending without accepting any', async () => {
      (
        mockMailerService.sendMail as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        accepted: [],
        pending: ['test@example.com'],
        rejected: [],
      });

      await expect(
        service.sendEmailViaSES({
          to: 'test@example.com',
          from: { name: 'Test App', email: 'no-reply@test.local' },
          subject: 'Test Subject',
          text: 'Test text',
          html: '<html>Test html</html>',
        }),
      ).rejects.toThrow('SES left recipient(s) pending: test@example.com');
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
      'AWS_SES_CONFIGURATION_SET',
    ])('should throw if %s is missing', envVar => {
      const original = process.env[envVar];
      delete process.env[envVar];
      expect(() => {
        const _s = new MailService(mockValidatorsService, mockMailerService);
        return _s;
      }).toThrow(`Environment variable ${envVar} is not set`);
      process.env[envVar] = original;
    });
  });
});
