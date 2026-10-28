import * as path from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import { MailerService } from '@nestjs-modules/mailer';
import * as ejs from 'ejs';
import { convert as htmlToText } from 'html-to-text';

import { ValidatorsService } from 'src/shared/utilities/validators.service';

/** Shape of an internal email message, sent through Amazon SES */
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
  private readonly _logger = new Logger('MailService');

  private readonly _noReplyEmailFromSender: { name: string; email: string } = {
    name: process.env.APP_TITLE!,
    email: process.env.EMAIL_NOREPLY_SENDER!,
  };

  private readonly _emailTemplatePath = path.join(
    __dirname,
    '..',
    'views',
    'email-templates',
  );

  /**
   * Creates an instance of MailService.
   *
   * @param _validatorsService - The validators service.
   * @param _mailerService - The mailer service.
   */
  constructor(
    private readonly _validatorsService: ValidatorsService,
    private readonly _mailerService: MailerService,
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
      'AWS_SES_CONFIGURATION_SET',
    ];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Environment variable ${envVar} is not set`);
      }
    }
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
      path.join(this._emailTemplatePath, templateName),
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

    await this.sendEmail(msg);
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

    await this.sendEmail(msg);
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

    await this.sendEmail(msg);
  }

  /**
   * Send an account closure confirmation email to the user.
   *
   * @param email - The recipient's email address.
   * @param firstName - The recipient's first name.
   * @returns A promise that resolves when the email has been sent.
   */
  async sendAccountClosureEmail(email: string, firstName: string) {
    const { emailHtmlContent, emailTextContent } =
      await this.generateEmailContent('account-closure-email.ejs', {
        appTitle: process.env.APP_TITLE,
        firstName: firstName,
        contactUsUrl: `${process.env.APP_FRONTEND_URL}/contact`,
      });

    const msg = this.generateEmailMessageObject(
      email,
      `Account closure for the ${process.env.APP_TITLE}`,
      emailTextContent,
      emailHtmlContent,
    );

    await this.sendEmail(msg);
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

    await this.sendEmail(msg);
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

    await this.sendEmail(msg);
  }

  /**
   * Send an email via Amazon SES.
   *
   * A failed send is logged as an error rather than thrown, so a caller's
   * request is not failed by an email it triggered as a side effect. The
   * mailer retries transient SES failures itself before giving up.
   *
   * @param message - The email message to send.
   * @returns A promise that resolves once SES has accepted the email or the failure has been logged.
   */
  async sendEmail(message: EmailMessage): Promise<void> {
    try {
      await this.sendEmailViaSES(message);
    } catch (sesError) {
      const reason =
        sesError instanceof Error ? sesError.message : String(sesError);

      this._logger.error('Amazon SES sending failed.', reason);
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

    const result = (await this._mailerService.sendMail(mailOptions as any)) as {
      rejected?: string[];
      pending?: string[];
      accepted?: string[];
      response?: string;
    };

    if ((result.rejected?.length ?? 0) > 0) {
      throw new Error(
        `SES rejected recipient(s): ${result.rejected!.join(', ')}`,
      );
    }

    if (
      (result.accepted?.length ?? 0) === 0 &&
      (result.pending?.length ?? 0) > 0
    ) {
      throw new Error(
        `SES left recipient(s) pending: ${result.pending!.join(', ')}`,
      );
    }
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
    return this._validatorsService.validateEmail(email);
  }

  /**
   * Generate an internal email message object from raw parts.
   *
   * @param to - The recipient's email address.
   * @param subject - The subject of the email.
   * @param text - The plain text content of the email.
   * @param html - The HTML content of the email.
   * @returns An EmailMessage object ready to send through SES.
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
      from: this._noReplyEmailFromSender,
      subject: finalSubject,
      text,
      html,
    };
  }
}
