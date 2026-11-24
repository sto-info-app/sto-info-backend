import * as path from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import { MailerService } from '@nestjs-modules/mailer';
import * as ejs from 'ejs';
import { convert as htmlToText } from 'html-to-text';

import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { SesWebhookService } from 'src/webhooks/ses/ses-webhook.service';

import { reservedMailDomain } from './utilities/reserved-mail-domain.utility';

/** Shape of an internal email message, sent through Amazon SES */
export interface EmailMessage {
  to: string;
  from: { name: string; email: string };
  subject: string;
  text: string;
  html: string;
  replyTo?: { email: string; name?: string };
  /** Extra headers, such as `List-Unsubscribe` (sc-1067). */
  headers?: Record<string, string>;
}

/** How {@link MailService.sendEmail} treats a message. */
export interface SendEmailOptions {
  /**
   * Skip an address SES bounced or had a complaint about. Notification and
   * login emails ask for it; an email somebody asked for, such as a password
   * reset, is still tried.
   */
  respectSuppression?: boolean;
  /**
   * Throw when SES fails, rather than logging, for a sender that retries,
   * such as the notification email outbox.
   */
  rethrow?: boolean;
}

/** An email's two parts. */
export interface RenderedEmail {
  html: string;
  text: string;
}

/** A footer to render below an email's content. */
export interface EmailFooter {
  /** The footer's template. */
  template: string;
  /** What it needs. */
  data: Record<string, unknown>;
}

/**
 * How the plain-text part is written from the branded HTML (sc-1067).
 *
 * The LCARS bars are layout, not words, so they are left out; a link whose
 * text is its own address is written once.
 */
export const EMAIL_TEXT_OPTIONS = {
  wordwrap: 130,
  selectors: [
    { selector: 'td.lcars-bar', format: 'skip' },
    { selector: 'a', options: { hideLinkIfSameAsText: true } },
    { selector: 'h2', options: { uppercase: false } },
  ],
};

/**
 * Where somebody manages their email notifications.
 *
 * @returns The Settings page's Notifications tab.
 */
export function emailSettingsUrl(): string {
  return `${process.env.APP_FRONTEND_URL}/dashboard/settings?tab=notifications`;
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
   * @param _suppression - Says which addresses SES bounced or complained of.
   */
  constructor(
    private readonly _validatorsService: ValidatorsService,
    private readonly _mailerService: MailerService,
    private readonly _suppression: SesWebhookService,
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
   * Renders an email in the branded layout every email shares (sc-1067).
   *
   * The template writes the content; the layout puts the LCARS header and
   * bars around it, and the footer, when there is one, below. The plain-text
   * part is written from the result.
   *
   * @param templateName - The content's EJS template.
   * @param templateData - What it needs. The app title is always given.
   * @param subject - The email's subject, which is also the page's title.
   * @param footer - A footer to render, if any.
   * @returns The HTML and plain-text parts.
   */
  async renderEmail(
    templateName: string,
    templateData: Record<string, unknown>,
    subject: string,
    footer?: EmailFooter,
  ): Promise<RenderedEmail> {
    const appTitle = process.env.APP_TITLE;
    const content: string = await ejs.renderFile(
      path.join(this._emailTemplatePath, templateName),
      { appTitle, ...templateData },
    );
    const footerHtml: string | null = footer
      ? await ejs.renderFile(
          path.join(this._emailTemplatePath, footer.template),
          {
            appTitle,
            ...footer.data,
          },
        )
      : null;

    return this.brand(content, subject, footerHtml);
  }

  /**
   * Puts content written elsewhere into the branded layout.
   *
   * @param content - The content, as HTML. It is placed as it is, so it must
   *   already be escaped.
   * @param subject - The email's subject.
   * @param footer - A footer, as HTML, or null.
   * @returns The HTML and plain-text parts.
   */
  async brand(
    content: string,
    subject: string,
    footer: string | null = null,
  ): Promise<RenderedEmail> {
    const html: string = await ejs.renderFile(
      path.join(this._emailTemplatePath, 'layout.ejs'),
      { appTitle: process.env.APP_TITLE, subject, content, footer },
    );

    return { html, text: htmlToText(html, EMAIL_TEXT_OPTIONS) };
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

    const subject = 'Please verify your email';
    const { html, text } = await this.renderEmail(
      'registration-verify-email.ejs',
      {
        verifyUrl: `${process.env.APP_FRONTEND_URL}/verify-email?token=${token}`,
      },
      subject,
    );

    const msg = this.generateEmailMessageObject(email, subject, text, html);

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

    const subject = `Password reset for the ${process.env.APP_TITLE}`;
    const { html, text } = await this.renderEmail(
      'password-reset-email.ejs',
      {
        passwordResetUrl: `${process.env.APP_FRONTEND_URL}/change-password?token=${token}`,
        firstName: firstName,
      },
      subject,
    );

    const msg = this.generateEmailMessageObject(email, subject, text, html);

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
    const subject = `Password changed for the ${process.env.APP_TITLE}`;
    const { html, text } = await this.renderEmail(
      'password-changed-email.ejs',
      {
        firstName: firstName,
        passwordResetUrl: `${process.env.APP_FRONTEND_URL}/reset-password`,
        contactUsUrl: `${process.env.APP_FRONTEND_URL}/contact`,
      },
      subject,
    );

    const msg = this.generateEmailMessageObject(email, subject, text, html);

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
    const subject = `Account closure for the ${process.env.APP_TITLE}`;
    const { html, text } = await this.renderEmail(
      'account-closure-email.ejs',
      {
        firstName: firstName,
        contactUsUrl: `${process.env.APP_FRONTEND_URL}/contact`,
      },
      subject,
    );

    const msg = this.generateEmailMessageObject(email, subject, text, html);

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
    const subject = `User logged in to ${process.env.APP_TITLE}`;
    const { html, text } = await this.renderEmail(
      'user-logged-in.ejs',
      {
        firstName: firstName,
        passwordResetUrl: `${process.env.APP_FRONTEND_URL}/reset-password`,
        contactUsUrl: `${process.env.APP_FRONTEND_URL}/contact`,
      },
      subject,
      {
        template: 'login-alert-footer.ejs',
        data: { settingsUrl: emailSettingsUrl() },
      },
    );

    const msg = this.generateEmailMessageObject(email, subject, text, html);

    await this.sendEmail(msg, { respectSuppression: true });
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
  async sendEmail(
    message: EmailMessage,
    options: SendEmailOptions = {},
  ): Promise<void> {
    // No mailbox can exist at a reserved domain, which is where test and
    // demonstration accounts live (FC-044); sent, it would only bounce.
    const reserved = reservedMailDomain(message.to);

    if (reserved !== null) {
      this._logger.log(
        `Email not sent: ${reserved} is reserved for testing, and no mailbox exists there - Subject: ${message.subject}`,
      );

      return;
    }

    if (options.respectSuppression && (await this.isSuppressed(message.to))) {
      this._logger.log(
        `Email not sent: the address is suppressed after a bounce or complaint - Subject: ${message.subject}`,
      );

      return;
    }

    try {
      await this.sendEmailViaSES(message);
    } catch (sesError) {
      if (options.rethrow) {
        throw sesError;
      }

      const reason =
        sesError instanceof Error ? sesError.message : String(sesError);

      this._logger.error('Amazon SES sending failed.', reason);
    }
  }

  /**
   * Whether emails to an address are paused after a hard bounce or a
   * complaint (sc-1067).
   *
   * A lookup that fails answers false: a notification email is not worth an
   * error, and SES refuses a suppressed address itself.
   *
   * @param email - The address.
   * @returns True while it is suppressed.
   */
  async isSuppressed(email: string): Promise<boolean> {
    try {
      return await this._suppression.isSuppressed(email);
    } catch (error) {
      this._logger.warn(
        `Suppression lookup failed - Reason: ${(error as Error).name}`,
      );

      return false;
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
      ...(message.headers ? { headers: message.headers } : {}),
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
