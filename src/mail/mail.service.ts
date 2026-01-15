import { Injectable, Logger } from '@nestjs/common';
import * as sgMail from '@sendgrid/mail';
import * as ejs from 'ejs';
import { convert as htmlToText } from 'html-to-text';
import * as path from 'node:path';
import { SecretsService } from 'src/shared/secrets/secrets.service';
import { ValidatorsService } from 'src/shared/utilities/validators.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger('MailService');

  private readonly noReplyEmailFromSender: { name: string; email: string } = {
    name: process.env.APP_TITLE,
    email: process.env.SENDGRID_NOREPLY_SENDER,
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
  ) {
    this.validateEnvironmentVariables();
  }

  /**
   * Validate required environment variables.
   * @throws Error if any required environment variable is not set.
   */
  private validateEnvironmentVariables() {
    const requiredEnvVars = [
      'APP_TITLE',
      'SENDGRID_NOREPLY_SENDER',
      'APP_FRONTEND_URL',
      'AWS_SECRET_NAME',
    ];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Environment variable ${envVar} is not set`);
      }
    }
  }

  /**
   * Initialise the mail service by setting the SendGrid API key.
   */
  async onModuleInit() {
    await this.init();
  }

  /**
   * Initialise the mail service.
   */
  private async init() {
    const secretObject = await this.secretsService.getSecret(
      process.env.AWS_SECRET_NAME,
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
   * @param email The recipient's email address.
   * @param token The verification token.
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

    await this.sendEmailViaSendGrid(msg);
  }

  /**
   * Send a password reset email to the user.
   * @param email The recipient's email address.
   * @param token The password reset token.
   * @param firstName The recipient's first name.
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

    await this.sendEmailViaSendGrid(msg);
  }

  /**
   * Send a password changed notification email to the user.
   * @param email The recipient's email address.
   * @param firstName The recipient's first name.
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

    await this.sendEmailViaSendGrid(msg);
  }

  /**
   * Send a password changed notification email to the user.
   * @param email The recipient's email address.
   * @param firstName The recipient's first name.
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

    await this.sendEmailViaSendGrid(msg);
  }

  /**
   * Send a generic email to a user.
   * @param toEmail The recipient's email address.
   * @param subject The subject of the email.
   * @param textContent The plain text content of the email.
   * @param htmlContent The HTML content of the email.
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

    await this.sendEmailViaSendGrid(msg);
  }

  /**
   * Send an email via SendGrid.
   * @param msg The email message to send.
   */
  async sendEmailViaSendGrid(message: sgMail.MailDataRequired) {
    try {
      await sgMail.send(message);
    } catch (error) {
      if (error?.response?.body?.errors) {
        this.logger.error(error.response.body.errors);
      } else {
        this.logger.error(error);
      }
    }
  }

  /**
   * Validate email format.
   * @param email The email address to validate.
   * @returns True if the email format is valid, false otherwise.
   */
  validateEmailFormat(email: string): boolean {
    if (!email) {
      return false;
    }
    return this.validatorsService.validateEmail(email);
  }

  /**
   * Generate an email message object.
   * @param to The recipient's email address.
   * @param subject The subject of the email.
   * @param text The plain text content of the email.
   * @param html The HTML content of the email.
   * @returns The email message object
   * @see https://sendgrid.com/docs/API_Reference/Web_API_v3/Mail/index.html
   */
  generateEmailMessageObject(
    to: string,
    subject: string,
    text: string,
    html: string,
  ): sgMail.MailDataRequired {
    if (!this.validateEmailFormat(to)) {
      throw new Error('Invalid email format');
    }

    return {
      to,
      from: this.noReplyEmailFromSender,
      subject,
      text,
      html,
    };
  }
}
