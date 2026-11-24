import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';
import { MailerService } from '@nestjs-modules/mailer';
import * as ejs from 'ejs';
import { convert as htmlToText } from 'html-to-text';

import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { SesWebhookService } from 'src/webhooks/ses/ses-webhook.service';

import { EmailMessage, MailService } from './mail.service';

jest.mock('@nestjs-modules/mailer');
jest.mock('ejs');
jest.mock('html-to-text');

describe('MailService', () => {
  let service: MailService;
  let mockValidatorsService: ValidatorsService;
  let mockMailerService: MailerService;
  let suppression: {
    isSuppressed: jest.Mock<(email: string) => Promise<boolean>>;
  };

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
          provide: SesWebhookService,
          useValue: { isSuppressed: jest.fn(() => Promise.resolve(false)) },
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
    suppression = module.get(SesWebhookService);
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
      await service.sendVerificationEmail('test@sto-info.app', 'token');
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
      await service.sendPasswordResetEmail(
        'test@sto-info.app',
        'token',
        'John',
      );
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
      await service.sendPasswordChangedEmail('test@sto-info.app', 'John');
      expect(mockMailerService.sendMail).toHaveBeenCalled();
    });
  });

  describe('sendAccountClosureEmail', () => {
    it('should send email successfully via SES', async () => {
      await service.sendAccountClosureEmail('test@sto-info.app', 'John');
      expect(mockMailerService.sendMail).toHaveBeenCalled();
    });
  });

  describe('sendUserLoggedInNotification', () => {
    it('should send email successfully via SES', async () => {
      await service.sendUserLoggedInNotification('test@sto-info.app', 'John');
      expect(mockMailerService.sendMail).toHaveBeenCalled();
    });

    // The login alert links to Settings, where it can be switched off.
    it('carries the footer pointing at the email settings (sc-1067)', async () => {
      await service.sendUserLoggedInNotification('test@sto-info.app', 'John');

      expect(ejs.renderFile).toHaveBeenCalledWith(
        expect.stringContaining('login-alert-footer.ejs'),
        {
          appTitle: 'Test App',
          settingsUrl:
            'https://test.local/dashboard/settings?tab=notifications',
        },
      );
    });

    it('is not sent to an address SES suppressed (sc-1067)', async () => {
      suppression.isSuppressed.mockResolvedValue(true);

      await service.sendUserLoggedInNotification('test@sto-info.app', 'John');

      expect(suppression.isSuppressed).toHaveBeenCalledWith(
        'test@sto-info.app',
      );
      expect(mockMailerService.sendMail).not.toHaveBeenCalled();
    });
  });

  // Every email wears one branded layout (sc-1067).
  describe('renderEmail', () => {
    it('renders the content, the footer, then the layout around both', async () => {
      (
        ejs.renderFile as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockImplementation(async (file: string) =>
        file.endsWith('layout.ejs') ? '<html>branded</html>' : `<p>${file}</p>`,
      );

      await expect(
        service.renderEmail(
          'notification-email.ejs',
          { firstName: 'Kirk' },
          'Subject line',
          { template: 'notification-email-footer.ejs', data: { labels: [] } },
        ),
      ).resolves.toEqual({ html: '<html>branded</html>', text: 'Test text' });

      const calls = (ejs.renderFile as jest.Mock).mock.calls;

      expect(calls[0]).toEqual([
        expect.stringContaining('notification-email.ejs'),
        { appTitle: 'Test App', firstName: 'Kirk' },
      ]);
      expect(calls[1]).toEqual([
        expect.stringContaining('notification-email-footer.ejs'),
        { appTitle: 'Test App', labels: [] },
      ]);
      expect(calls[2]).toEqual([
        expect.stringContaining('layout.ejs'),
        {
          appTitle: 'Test App',
          subject: 'Subject line',
          content: expect.stringContaining('notification-email.ejs'),
          footer: expect.stringContaining('notification-email-footer.ejs'),
        },
      ]);
      expect(htmlToText).toHaveBeenCalledWith(
        '<html>branded</html>',
        expect.objectContaining({ wordwrap: 130 }),
      );
    });

    it('renders no footer when none is given', async () => {
      await service.renderEmail('notification-email.ejs', {}, 'Subject');

      expect((ejs.renderFile as jest.Mock).mock.calls[1][1]).toEqual(
        expect.objectContaining({ footer: null }),
      );
    });
  });

  describe('isSuppressed', () => {
    it('asks the SES records', async () => {
      suppression.isSuppressed.mockResolvedValue(true);

      await expect(service.isSuppressed('a@sto-info.app')).resolves.toBe(true);
    });

    // SES refuses a suppressed address itself; a lookup failing is no error.
    it('answers false when the lookup fails', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      suppression.isSuppressed.mockRejectedValue(new RangeError('down'));

      await expect(service.isSuppressed('a@sto-info.app')).resolves.toBe(false);
    });
  });

  describe('sendEmailToUser', () => {
    it('should send generic email successfully via SES', async () => {
      await service.sendEmailToUser('test@sto-info.app', 'Sub', 'Text', 'Html');
      expect(mockMailerService.sendMail).toHaveBeenCalled();
    });
  });

  describe('sendEmail', () => {
    const sampleMessage: EmailMessage = {
      to: 'test@sto-info.app',
      from: { name: 'Test App', email: 'no-reply@test.local' },
      subject: 'Test Subject',
      text: 'Test text',
      html: '<html>Test html</html>',
    };

    it('should send via SES', async () => {
      await service.sendEmail(sampleMessage);
      expect(mockMailerService.sendMail).toHaveBeenCalledTimes(1);
      // Nobody asked about suppression, so nothing was looked up.
      expect(suppression.isSuppressed).not.toHaveBeenCalled();
    });

    it('passes extra headers, such as List-Unsubscribe, to SES (sc-1067)', async () => {
      await service.sendEmail({
        ...sampleMessage,
        headers: { 'List-Unsubscribe': '<https://api.test/x>' },
      });

      expect(mockMailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { 'List-Unsubscribe': '<https://api.test/x>' },
        }),
      );
    });

    it('sends to an address that is not suppressed when asked to check', async () => {
      await service.sendEmail(sampleMessage, { respectSuppression: true });

      expect(mockMailerService.sendMail).toHaveBeenCalledTimes(1);
    });

    it('throws a failed send for a sender that retries (sc-1067)', async () => {
      (
        mockMailerService.sendMail as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(new Error('SES down'));

      await expect(
        service.sendEmail(sampleMessage, { rethrow: true }),
      ).rejects.toThrow('SES down');
    });

    // FC-044: test and demonstration accounts live at reserved domains.
    it('sends nothing to a domain reserved for testing, and says so', async () => {
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      try {
        await service.sendEmail({
          ...sampleMessage,
          to: 'demo-user-014@example.com',
        });

        expect(mockMailerService.sendMail).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(
          'Email not sent: example.com is reserved for testing, and no mailbox exists there - Subject: Test Subject',
        );
      } finally {
        logSpy.mockRestore();
      }
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
        rejected: ['test@sto-info.app'],
        response: '550 rejected',
      });
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await service.sendEmail(sampleMessage);

      expect(errorSpy).toHaveBeenCalledWith(
        'Amazon SES sending failed.',
        'SES rejected recipient(s): test@sto-info.app',
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
        to: 'test@sto-info.app',
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
      ).mockResolvedValue({ accepted: ['test@sto-info.app'], rejected: [] });

      const message: EmailMessage = {
        to: 'test@sto-info.app',
        from: { name: 'Test App', email: 'no-reply@test.local' },
        subject: 'Test Subject',
        text: 'Test text',
        html: '<html>Test html</html>',
      };

      await service.sendEmailViaSES(message);

      expect(mockMailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@sto-info.app',
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
        rejected: ['test@sto-info.app'],
      });

      await expect(
        service.sendEmailViaSES({
          to: 'test@sto-info.app',
          from: { name: 'Test App', email: 'no-reply@test.local' },
          subject: 'Test Subject',
          text: 'Test text',
          html: '<html>Test html</html>',
        }),
      ).rejects.toThrow('SES rejected recipient(s): test@sto-info.app');
    });

    it('should throw when SES leaves recipients pending without accepting any', async () => {
      (
        mockMailerService.sendMail as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        accepted: [],
        pending: ['test@sto-info.app'],
        rejected: [],
      });

      await expect(
        service.sendEmailViaSES({
          to: 'test@sto-info.app',
          from: { name: 'Test App', email: 'no-reply@test.local' },
          subject: 'Test Subject',
          text: 'Test text',
          html: '<html>Test html</html>',
        }),
      ).rejects.toThrow('SES left recipient(s) pending: test@sto-info.app');
    });

    it('should include replyTo header when replyTo is provided', async () => {
      const message: EmailMessage = {
        to: 'test@sto-info.app',
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
        to: 'test@sto-info.app',
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
        'test@sto-info.app',
        'Test Subject',
        'text',
        'html',
      );
      expect(result.subject).toBe('Test Subject [development]');
    });

    it('should not append environment to subject when NODE_ENV is prod', () => {
      process.env.NODE_ENV = 'prod';
      const result = service.generateEmailMessageObject(
        'test@sto-info.app',
        'Test Subject',
        'text',
        'html',
      );
      expect(result.subject).toBe('Test Subject');
    });

    it('should return correct message object structure', () => {
      const result = service.generateEmailMessageObject(
        'test@sto-info.app',
        'Test Subject',
        'Test text',
        '<html>Test html</html>',
      );
      expect(result).toHaveProperty('to', 'test@sto-info.app');
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
        const _s = new MailService(
          mockValidatorsService,
          mockMailerService,
          {} as SesWebhookService,
        );
        return _s;
      }).toThrow(`Environment variable ${envVar} is not set`);
      process.env[envVar] = original;
    });
  });
});
