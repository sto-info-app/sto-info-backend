import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MailService } from 'src/mail/mail.service';
import { Repository } from 'typeorm';
import { ContactRequestDto } from './dto/contact-request.dto';
import { ContactRequestEntity } from './entities/contact-request.entity';

const SUPPORT_EMAIL = 'support@startrekonline.info';

@Injectable()
export class ContactService {
  constructor(
    private readonly mailService: MailService,
    @InjectRepository(ContactRequestEntity)
    private readonly contactRequestRepository: Repository<ContactRequestEntity>,
  ) {}

  async submitContactRequest(payload: ContactRequestDto): Promise<void> {
    const maskedEmail = this.maskEmail(payload.email);
    const contactRequest = this.contactRequestRepository.create({
      name: payload.name,
      emailMasked: maskedEmail,
      topic: payload.topic,
      message: payload.message,
    });
    await this.contactRequestRepository.save(contactRequest);

    const supportSubject = `Contact request: ${payload.topic}`;
    const supportTextContent = this.buildSupportTextContent(payload);
    const supportHtmlContent = this.buildSupportHtmlContent(payload);

    const supportMessage = this.mailService.generateEmailMessageObject(
      SUPPORT_EMAIL,
      supportSubject,
      supportTextContent,
      supportHtmlContent,
    );

    await this.mailService.sendEmailViaSendGrid({
      ...supportMessage,
      replyTo: {
        email: payload.email,
        name: payload.name,
      },
    });

    const userSubject = `We received your message`;
    const userTextContent = this.buildUserTextContent(payload);
    const userHtmlContent = this.buildUserHtmlContent(payload);
    const userMessage = this.mailService.generateEmailMessageObject(
      payload.email,
      userSubject,
      userTextContent,
      userHtmlContent,
    );

    await this.mailService.sendEmailViaSendGrid(userMessage);
  }

  private buildSupportTextContent(payload: ContactRequestDto): string {
    return [
      `Name: ${payload.name}`,
      `Email: ${payload.email}`,
      `Topic: ${payload.topic}`,
      '',
      payload.message,
    ].join('\n');
  }

  private buildSupportHtmlContent(payload: ContactRequestDto): string {
    const name = this.escapeHtml(payload.name);
    const email = this.escapeHtml(payload.email);
    const topic = this.escapeHtml(payload.topic);
    const message = this.escapeHtml(payload.message).replace(
      /\r?\n/g,
      '<br />',
    );

    return `
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Topic:</strong> ${topic}</p>
      <p><strong>Message:</strong><br />${message}</p>
    `.trim();
  }

  private buildUserTextContent(payload: ContactRequestDto): string {
    const appTitle = process.env.APP_TITLE ?? 'our team';
    return [
      `Hi ${payload.name},`,
      '',
      `Thanks for contacting ${appTitle}. We have received your message about "${payload.topic}".`,
      'We will review it and get back to you if needed.',
      '',
      'Your message:',
      payload.message,
    ].join('\n');
  }

  private buildUserHtmlContent(payload: ContactRequestDto): string {
    const appTitle = this.escapeHtml(process.env.APP_TITLE ?? 'our team');
    const name = this.escapeHtml(payload.name);
    const topic = this.escapeHtml(payload.topic);
    const message = this.escapeHtml(payload.message).replace(
      /\r?\n/g,
      '<br />',
    );

    return `
      <p>Hi ${name},</p>
      <p>Thanks for contacting ${appTitle}. We have received your message about "${topic}".</p>
      <p>We will review it and get back to you if needed.</p>
      <p><strong>Your message:</strong><br />${message}</p>
    `.trim();
  }

  private maskEmail(email: string): string {
    const atIndex = email.lastIndexOf('@');
    if (atIndex <= 0) {
      return email;
    }

    const localPart = email.slice(0, atIndex);
    const domain = email.slice(atIndex + 1);
    const maskedLocal = this.maskLocalPart(localPart);
    return `${maskedLocal}@${domain}`;
  }

  private maskLocalPart(localPart: string): string {
    if (localPart.length <= 2) {
      return '*'.repeat(localPart.length);
    }

    const isShortLocal = localPart.length <= 4;
    const prefixLength = isShortLocal ? 1 : 2;
    const suffixLength = isShortLocal ? 1 : 2;

    const maskedLength = Math.max(
      localPart.length - prefixLength - suffixLength,
      0,
    );
    const prefix = localPart.slice(0, prefixLength);
    const suffix = localPart.slice(-suffixLength);
    return `${prefix}${'*'.repeat(maskedLength)}${suffix}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
