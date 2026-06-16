import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MailService } from 'src/mail/mail.service';
import { Repository } from 'typeorm';
import { ContactRequestDto } from './dto/contact-request.dto';
import { ContactRequestEntity } from './entities/contact-request.entity';

const SUPPORT_EMAIL = 'support@startrekonline.info';

@Injectable()
export class ContactService {
  /**
   * Creates an instance of ContactService.
   *
   * @param mailService - The mail service.
   * @param contactRequestRepository - The contact request repository.
   */
  constructor(
    private readonly mailService: MailService,
    @InjectRepository(ContactRequestEntity)
    private readonly contactRequestRepository: Repository<ContactRequestEntity>,
  ) {}

  /**
   * Submit a contact request, persists it to the database, and sends
   * notification emails to both the support team and the requester.
   *
   * @param payload - The data for the contact request.
   * @returns A promise that resolves when the request has been processed and emails sent.
   */
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

    await this.mailService.sendEmailWithFallback({
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

    await this.mailService.sendEmailWithFallback(userMessage);
  }

  /**
   * Build the plain text content for the support notification email.
   *
   * @param payload - The contact request data.
   * @returns The formatted plain text content.
   */
  private buildSupportTextContent(payload: ContactRequestDto): string {
    return [
      `Name: ${payload.name}`,
      `Email: ${payload.email}`,
      `Topic: ${payload.topic}`,
      '',
      payload.message,
    ].join('\n');
  }

  /**
   * Build the HTML content for the support notification email.
   *
   * @param payload - The contact request data.
   * @returns The formatted HTML string.
   */
  private buildSupportHtmlContent(payload: ContactRequestDto): string {
    const name = this.escapeHtml(payload.name);
    const email = this.escapeHtml(payload.email);
    const topic = this.escapeHtml(payload.topic);
    const message = this.escapeHtml(payload.message).replaceAll(
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

  /**
   * Build the plain text content for the user's confirmation email.
   *
   * @param payload - The contact request data.
   * @returns The formatted plain text content.
   */
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

  /**
   * Build the HTML content for the user's confirmation email.
   *
   * @param payload - The contact request data.
   * @returns The formatted HTML string.
   */
  private buildUserHtmlContent(payload: ContactRequestDto): string {
    const appTitle = this.escapeHtml(process.env.APP_TITLE ?? 'our team');
    const name = this.escapeHtml(payload.name);
    const topic = this.escapeHtml(payload.topic);
    const message = this.escapeHtml(payload.message).replaceAll(
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

  /**
   * Mask an email address to protect privacy in the database.
   *
   * @param email - The raw email address.
   * @returns The masked email address (e.g., "jo**@example.com").
   */
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

  /**
   * Mask the local part of an email address.
   *
   * @param localPart - The part of the email before the "@" symbol.
   * @returns The masked local part string.
   */
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

  /**
   * Escapes HTML special characters in a string to prevent XSS.
   *
   * @param value - The raw string to escape.
   * @returns The escaped HTML string.
   */
  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}
