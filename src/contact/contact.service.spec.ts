import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MailService } from 'src/mail/mail.service';
import { Repository } from 'typeorm';
import { ContactService } from './contact.service';
import { ContactRequestEntity } from './entities/contact-request.entity';

describe('ContactService', () => {
  let service: ContactService;
  type MailServiceMock = jest.Mocked<
    Pick<MailService, 'generateEmailMessageObject' | 'sendEmailWithFallback'>
  >;
  type EmailMessage = Parameters<MailService['sendEmailWithFallback']>[0];
  let mailService: MailServiceMock;
  let repository: Repository<ContactRequestEntity>;

  beforeEach(async () => {
    mailService = {
      generateEmailMessageObject: jest.fn(),
      sendEmailWithFallback: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        {
          provide: MailService,
          useValue: mailService,
        },
        {
          provide: getRepositoryToken(ContactRequestEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ContactService>(ContactService);
    repository = module.get<Repository<ContactRequestEntity>>(
      getRepositoryToken(ContactRequestEntity),
    );
  });

  it('should store masked email and send support + user emails', async () => {
    const payload = {
      name: 'Name',
      email: 'janedoe@example.com',
      topic: 'other',
      message: 'Hello <b>there</b>',
    };

    const supportMessageStub = {
      to: 'support@startrekonline.info',
      from: { name: 'App', email: 'no-reply@example.com' },
      subject: 'Contact request: other',
      text: 'text',
      html: 'html',
    };
    const userMessageStub = {
      to: 'janedoe@example.com',
      from: { name: 'App', email: 'no-reply@example.com' },
      subject: 'We received your message',
      text: 'text',
      html: 'html',
    };

    (repository.create as jest.Mock).mockReturnValue({
      id: '1',
      name: payload.name,
      emailMasked: 'ja***oe@example.com',
      topic: payload.topic,
      message: payload.message,
    });

    mailService.generateEmailMessageObject
      .mockReturnValueOnce(supportMessageStub as EmailMessage)
      .mockReturnValueOnce(userMessageStub as EmailMessage);

    await service.submitContactRequest(payload);

    expect(repository.create).toHaveBeenCalledWith({
      name: payload.name,
      emailMasked: 'ja***oe@example.com',
      topic: payload.topic,
      message: payload.message,
    });
    expect(repository.save).toHaveBeenCalled();

    const [, , supportTextContent, supportHtmlContent] =
      mailService.generateEmailMessageObject.mock.calls[0];

    expect(supportTextContent).toContain('Hello <b>there</b>');
    expect(supportHtmlContent).toContain('Hello &lt;b&gt;there&lt;/b&gt;');
    expect(mailService.sendEmailWithFallback).toHaveBeenCalledWith({
      ...supportMessageStub,
      replyTo: { email: payload.email, name: payload.name },
    });

    expect(mailService.sendEmailWithFallback).toHaveBeenCalledWith(
      userMessageStub,
    );
  });

  it('should mask short email local parts', async () => {
    const payload = {
      name: 'Name',
      email: 'abc@example.com',
      topic: 'other',
      message: 'Message',
    };

    (repository.create as jest.Mock).mockReturnValue({
      id: '1',
      name: payload.name,
      emailMasked: 'a*c@example.com',
      topic: payload.topic,
      message: payload.message,
    });

    mailService.generateEmailMessageObject.mockReturnValue({} as EmailMessage);

    await service.submitContactRequest(payload);

    expect(repository.create).toHaveBeenCalledWith({
      name: payload.name,
      emailMasked: 'a*c@example.com',
      topic: payload.topic,
      message: payload.message,
    });
  });

  it('should keep email unchanged when missing @', () => {
    const result = (service as any).maskEmail('not-an-email');
    expect(result).toBe('not-an-email');
  });

  it('should keep email unchanged when local part is empty', () => {
    const result = (service as any).maskEmail('@example.com');
    expect(result).toBe('@example.com');
  });

  it('should escape HTML characters', () => {
    const result = (service as any).escapeHtml(`&<>"'`);
    expect(result).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('should format support HTML with newlines converted', () => {
    const payload = {
      name: 'Name',
      email: 'name@example.com',
      topic: 'other',
      message: 'Line 1\nLine 2',
    };

    const result = (service as any).buildSupportHtmlContent(payload);

    expect(result).toContain('Line 1<br />Line 2');
  });

  it('should mask single-character local parts', () => {
    const result = (service as any).maskEmail('a@example.com');
    expect(result).toBe('*@example.com');
  });

  it('should mask two-character local parts', () => {
    const result = (service as any).maskEmail('ab@example.com');
    expect(result).toBe('**@example.com');
  });

  it('should mask three-character local parts', () => {
    const result = (service as any).maskEmail('abc@example.com');
    expect(result).toBe('a*c@example.com');
  });

  it('should mask five-character local parts using two chars', () => {
    const result = (service as any).maskEmail('abcde@example.com');
    expect(result).toBe('ab*de@example.com');
  });

  it('should mask four-character local parts', () => {
    const result = (service as any).maskEmail('abcd@example.com');
    expect(result).toBe('a**d@example.com');
  });

  it('should use default app title when missing', () => {
    const originalTitle = process.env.APP_TITLE;
    delete process.env.APP_TITLE;

    const payload = {
      name: 'Name',
      email: 'name@example.com',
      topic: 'other',
      message: 'Message',
    };

    const result = (service as any).buildUserTextContent(payload);

    expect(result).toContain('Thanks for contacting our team.');

    if (originalTitle) {
      process.env.APP_TITLE = originalTitle;
    }
  });

  it('should keep empty domain when email ends with @', () => {
    const result = (service as any).maskEmail('ab@');
    expect(result).toBe('**@');
  });

  it('should convert CRLF newlines in support HTML', () => {
    const payload = {
      name: 'Name',
      email: 'name@example.com',
      topic: 'other',
      message: 'Line 1\r\nLine 2',
    };

    const result = (service as any).buildSupportHtmlContent(payload);

    expect(result).toContain('Line 1<br />Line 2');
  });

  it('should convert newlines in user HTML content', () => {
    const payload = {
      name: 'Name',
      email: 'name@example.com',
      topic: 'other',
      message: 'Line 1\nLine 2',
    };

    const result = (service as any).buildUserHtmlContent(payload);

    expect(result).toContain('Line 1<br />Line 2');
  });

  it('should include provided app title in text email', () => {
    const originalTitle = process.env.APP_TITLE;
    process.env.APP_TITLE = 'STO App';

    const payload = {
      name: 'Name',
      email: 'name@example.com',
      topic: 'other',
      message: 'Message',
    };

    const result = (service as any).buildUserTextContent(payload);

    expect(result).toContain('Thanks for contacting STO App.');

    if (originalTitle) {
      process.env.APP_TITLE = originalTitle;
    } else {
      delete process.env.APP_TITLE;
    }
  });

  it('should use escaped app title when provided', () => {
    const originalTitle = process.env.APP_TITLE;
    process.env.APP_TITLE = 'STO & Co';

    const payload = {
      name: 'Name',
      email: 'name@example.com',
      topic: 'other',
      message: 'Message',
    };

    const result = (service as any).buildUserHtmlContent(payload);

    expect(result).toContain('STO &amp; Co');

    if (originalTitle) {
      process.env.APP_TITLE = originalTitle;
    } else {
      delete process.env.APP_TITLE;
    }
  });

  it('should use default app title in HTML when missing', () => {
    const originalTitle = process.env.APP_TITLE;
    delete process.env.APP_TITLE;

    const payload = {
      name: 'Name',
      email: 'name@example.com',
      topic: 'other',
      message: 'Message',
    };

    const result = (service as any).buildUserHtmlContent(payload);

    expect(result).toContain('Thanks for contacting our team.');

    if (originalTitle) {
      process.env.APP_TITLE = originalTitle;
    }
  });

  it('should mask long local parts using two chars', () => {
    const result = (service as any).maskEmail('janedoe@example.com');
    expect(result).toBe('ja***oe@example.com');
  });
});
