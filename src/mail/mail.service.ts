import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger } from '@nestjs/common';
import * as sgMail from '@sendgrid/mail';
import * as ejs from 'ejs';
import { convert as htmlToText } from 'html-to-text';
import * as path from 'node:path';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { ValidatorsService } from 'src/shared/utilities/validators.service';

/** Shape of an internal email message used for both SES and SendGrid */
export interface EmailMessage {
  to: string;
  from: { name: string; email: string };
  subject: string;
  text: string;
  html: string;
  replyTo?: { email: string; name?: string };
}

@Injectable()
export class MailService {
  private readonly logger = new Logger('MailService');

  private readonly noReplyEmailFromSender: { name: string; email: string } = {
    name: process.env.APP_TITLE!,
    email: process.env.EMAIL_NOREPLY_SENDER!,
  };

  private readonly emailTemplatePath = path.join(
    __dirname,
    '..',
    'views',
    'email-templates',
  );

  constructor(
    private readonly secretsService: SecretsService,
    private readonly validatorsService: ValidatorsService,
    private readonly mailerService: MailerService,
  ) {
    this.validateEnvironmentVariables();
  }

  /**
   * Validate required environment variables.
   *
   * @throws Error if any required environment variable is not set.
   * @returns void
   */
  private validateEnvironmentVariables() {
    const requiredEnvVars = [
      'APP_TITLE',
      'EMAIL_NOREPLY_SENDER',
      'APP_FRONTEND_URL',
      'AWS_SECRET_NAME',
      'AWS_SES_CONFIGURATION_SET',
    ];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Environment variable ${envVar} is not set`);
      }
    }
  }

  /**
   * Initialise the mail service by setting the SendGrid API key.
   *
   * @returns A promise that resolves when initialisation is complete.
   */
  async onModuleInit() {
    await this.init();
  }

  /**
   * Initialise the mail service — fetches secrets for the SendGrid fallback.
   *
   * @returns A promise that resolves when primary initialisation is complete.
   */
  private async init() {
    const secretObject = await this.secretsService.getSecret(
      process.env.AWS_SECRET_NAME!,
    );

    sgMail.setApiKey(secretObject.sendGridApiKey);
  }

  /**
   * Generate email content from an EJS template.
   * @param templateName The name of the EJS template file.
   * @param templateData The data to be passed to the template.
   * @returns An object containing the HTML and text content of the email.
   */
  private async generateEmailContent(
    templateName: string,
    templateData: any,
  ): Promise<{ emailHtmlContent: string; emailTextContent: string }> {
    const emailHtmlContent: string = await ejs.renderFile(
      path.join(this.emailTemplatePath, templateName),
      templateData,
    );
    const emailTextContent: string = htmlToText(emailHtmlContent, {
      wordwrap: 130,
    });

    return { emailHtmlContent, emailTextContent };
  }

  /**
   * Send a verification email to the user.
   *
   * @param email - The recipient's email address.
   * @param token - The verification token.
   * @returns A promise that resolves when the email has been sent.
   */
  async sendVerificationEmail(email: string, token: string) {
    if (!this.validateEmailFormat(email)) {
      throw new Error('Invalid email format');
    }

    const { emailHtmlContent, emailTextContent } =
      await this.generateEmailContent('registration-verify-email.ejs', {
        appTitle: process.env.APP_TITLE,
        verifyUrl: `${process.env.APP_FRONTEND_URL}/verify-email?token=${token}`,
      });

    const msg = this.generateEmailMessageObject(
      email,
      'Please verify your email',
      emailTextContent,
      emailHtmlContent,
    );

    await this.sendEmailWithFallback(msg);
  }

  /**
   * Send a password reset email to the user.
   *
   * @param email - The recipient's email address.
   * @param token - The password reset token.
   * @param firstName - The recipient's first name.
   * @returns A promise that resolves when the email has been sent.
   */
  async sendPasswordResetEmail(
    email: string,
    token: string,
    firstName: string,
  ) {
    if (!this.validateEmailFormat(email)) {
      throw new Error('Invalid email format');
    }

    const { emailHtmlContent, emailTextContent } =
      await this.generateEmailContent('password-reset-email.ejs', {
        appTitle: process.env.APP_TITLE,
        passwordResetUrl: `${process.env.APP_FRONTEND_URL}/change-password?token=${token}`,
        firstName: firstName,
      });

    const msg = this.generateEmailMessageObject(
      email,
      `Password reset for the ${process.env.APP_TITLE}`,
      emailTextContent,
      emailHtmlContent,
    );

    await this.sendEmailWithFallback(msg);
  }

  /**
   * Send a password changed notification email to the user.
   *
   * @param email - The recipient's email address.
   * @param firstName - The recipient's first name.
   * @returns A promise that resolves when the email has been sent.
   */
  async sendPasswordChangedEmail(email: string, firstName: string) {
    const { emailHtmlContent, emailTextContent } =
      await this.generateEmailContent('password-changed-email.ejs', {
        appTitle: process.env.APP_TITLE,
        firstName: firstName,
        passwordResetUrl: `${process.env.APP_FRONTEND_URL}/reset-password`,
        contactUsUrl: `${process.env.APP_FRONTEND_URL}/contact`,
      });

    const msg = this.generateEmailMessageObject(
      email,
      `Password changed for the ${process.env.APP_TITLE}`,
      emailTextContent,
      emailHtmlContent,
    );

    await this.sendEmailWithFallback(msg);
  }

  /**
   * Send a user logged in notification email to the user.
   *
   * @param email - The recipient's email address.
   * @param firstName - The recipient's first name.
   * @returns A promise that resolves when the email has been sent.
   */
  async sendUserLoggedInNotification(email: string, firstName: string) {
    const { emailHtmlContent, emailTextContent } =
      await this.generateEmailContent('user-logged-in.ejs', {
        appTitle: process.env.APP_TITLE,
        firstName: firstName,
        passwordResetUrl: `${process.env.APP_FRONTEND_URL}/reset-password`,
        contactUsUrl: `${process.env.APP_FRONTEND_URL}/contact`,
      });

    const msg = this.generateEmailMessageObject(
      email,
      `User logged in to ${process.env.APP_TITLE}`,
      emailTextContent,
      emailHtmlContent,
    );

    await this.sendEmailWithFallback(msg);
  }

  /**
   * Send a generic email to a user.
   *
   * @param toEmail - The recipient's email address.
   * @param subject - The subject of the email.
   * @param textContent - The plain text content of the email.
   * @param htmlContent - The HTML content of the email.
   * @returns A promise that resolves when the email has been sent.
   */
  async sendEmailToUser(
    toEmail: string,
    subject: string,
    textContent: string,
    htmlContent: string,
  ) {
    const msg = this.generateEmailMessageObject(
      toEmail,
      subject,
      textContent,
      htmlContent,
    );

    await this.sendEmailWithFallback(msg);
  }

  /**
   * Send an email via Amazon SES (primary), falling back to SendGrid on failure.
   *
   * @param message - The email message to send.
   * @returns A promise that resolves when the email has been sent (via either provider).
   */
  async sendEmailWithFallback(message: EmailMessage): Promise<void> {
    try {
      await this.sendEmailViaSES(message);
    } catch (sesError) {
      this.logger.warn(
        'Amazon SES sending failed — falling back to SendGrid.',
        sesError instanceof Error ? sesError.message : String(sesError),
      );
      await this.sendEmailViaSendGrid(this.toSendGridMessage(message));
    }
  }

  /**
   * Send an email via Amazon SES using the NestJS mailer service (nodemailer SES transport).
   *
   * @param message - The email message to send.
   * @returns A promise that resolves when the email has been successfully queued/sent by SES.
   */
  async sendEmailViaSES(message: EmailMessage): Promise<void> {
    // `ses` is a nodemailer SES-transport passthrough field for provider-specific
    // options (e.g. ConfigurationSetName). ISendMailOptions doesn't expose it in
    // its TypeScript definition, so we widen to unknown before the call.
    const mailOptions = {
      to: message.to,
      from: `"${message.from.name}" <${message.from.email}>`,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo
        ? {
            replyTo: `"${message.replyTo.name ?? ''}" <${message.replyTo.email}>`,
          }
        : {}),
      // Route bounce/complaint/delivery events through the SES configuration set
      // so they are published to the SNS topic consumed by POST /webhooks/ses.
      ses: {
        ConfigurationSetName:
          process.env.AWS_SES_CONFIGURATION_SET ?? undefined,
      },
    };

    await this.mailerService.sendMail(mailOptions as any);
  }

  /**
   * Send an email via SendGrid (fallback).
   *
   * @param message - The SendGrid email message to send.
   * @returns A promise that resolves when the email has been sent via SendGrid.
   */
  async sendEmailViaSendGrid(message: sgMail.MailDataRequired) {
    try {
      await sgMail.send(message);
    } catch (error) {
      const err = error as any;
      if (err?.response?.body?.errors) {
        this.logger.error(err.response.body.errors);
      } else {
        this.logger.error(err);
      }
    }
  }

  /**
   * Convert an internal EmailMessage to a SendGrid MailDataRequired object.
   *
   * @param message - The internal email message.
   * @returns A SendGrid MailDataRequired object.
   */
  toSendGridMessage(message: EmailMessage): sgMail.MailDataRequired {
    return {
      to: message.to,
      from: message.from,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    };
  }

  /**
   * Validate email format using the internal validators service.
   *
   * @param email - The email address to validate.
   * @returns `true` if the email format is valid; `false` otherwise.
   */
  validateEmailFormat(email: string | null | undefined): boolean {
    if (!email) {
      return false;
    }
    return this.validatorsService.validateEmail(email);
  }

  /**
   * Generate an internal email message object from raw parts.
   *
   * @param to - The recipient's email address.
   * @param subject - The subject of the email.
   * @param text - The plain text content of the email.
   * @param html - The HTML content of the email.
   * @returns An EmailMessage object ready for use by SES or SendGrid.
   */
  generateEmailMessageObject(
    to: string,
    subject: string,
    text: string,
    html: string,
  ): EmailMessage {
    if (!this.validateEmailFormat(to)) {
      throw new Error('Invalid email format');
    }

    const finalSubject =
      process.env.NODE_ENV === 'prod'
        ? subject
        : `${subject} [${process.env.NODE_ENV}]`;

    return {
      to,
      from: this.noReplyEmailFromSender,
      subject: finalSubject,
      text,
      html,
    };
  }
}
