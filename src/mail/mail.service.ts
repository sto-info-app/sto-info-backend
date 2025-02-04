import { Injectable, Logger } from '@nestjs/common';
import * as sgMail from '@sendgrid/mail';
import * as ejs from 'ejs';
import { convert as htmlToText } from 'html-to-text';
import * as path from 'path';
import { SecretsService } from 'src/shared/secrets/secrets.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger('MailService');

  private readonly noReplyEmailFromSender: { name: string; email: string } = {
    name: process.env.APP_TITLE,
    email: process.env.SENDGRID_NOREPLY_SENDER,
  };

  private readonly emailTemplatePath = path.join(
    __dirname,
    '../..',
    'email-templates',
  );

  constructor(private readonly secretsService: SecretsService) {}

  /**
   * Initialise the mail service when the module is initialized.
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
   * Send an email to the user to verify their email address.
   * @param email
   * @param token
   */
  async sendVerificationEmail(email: string, token: string) {
    const emailHtmlContent = await ejs.renderFile(
      path.join(this.emailTemplatePath, 'registration-verify-email.ejs'),
      {
        appTitle: process.env.APP_TITLE,
        verifyUrl:
          process.env.APP_FRONTEND_URL + '/verify-email?token=' + token,
      },
    );
    const emailTextContent = htmlToText(emailHtmlContent, {
      wordwrap: 130,
    });

    const msg = {
      to: email,
      from: this.noReplyEmailFromSender,
      subject: 'Please verify your email',
      text: emailTextContent,
      html: emailHtmlContent,
    };

    try {
      await sgMail.send(msg);
    } catch (error) {
      if (error.response) {
        this.logger.error(error.response.body.errors);
      } else {
        this.logger.error(error);
      }
    }
  }

  /**
   * Send an email to the user when the password reset has been requested.
   * @param email
   * @param token
   * @param firstName
   */
  async sendPasswordResetEmail(
    email: string,
    token: string,
    firstName: string,
  ) {
    const emailHtmlContent = await ejs.renderFile(
      path.join(this.emailTemplatePath, 'password-reset-email.ejs'),
      {
        appTitle: process.env.APP_TITLE,
        passwordResetUrl:
          process.env.APP_FRONTEND_URL + '/change-password?token=' + token,
        firstName: firstName,
      },
    );
    const emailTextContent = htmlToText(emailHtmlContent, {
      wordwrap: 130,
    });

    const msg = {
      to: email,
      from: this.noReplyEmailFromSender,
      subject: 'Password reset for the ' + process.env.APP_TITLE,
      text: emailTextContent,
      html: emailHtmlContent,
    };

    try {
      await sgMail.send(msg);
    } catch (error) {
      if (error.response) {
        this.logger.error(error.response.body.errors);
      } else {
        this.logger.error(error);
      }
    }
  }

  /**
   * Send an email to the user when the password has been changed.
   * @param email
   * @param firstName
   */
  async sendPasswordChangedEmail(email: string, firstName: string) {
    const emailHtmlContent = await ejs.renderFile(
      path.join(this.emailTemplatePath, 'password-changed-email.ejs'),
      {
        appTitle: process.env.APP_TITLE,
        firstName: firstName,
        passwordResetUrl: process.env.APP_FRONTEND_URL + '/reset-password',
        contactUsUrl: process.env.APP_FRONTEND_URL + '/contact',
      },
    );
    const emailTextContent = htmlToText(emailHtmlContent, {
      wordwrap: 130,
    });

    const msg = {
      to: email,
      from: this.noReplyEmailFromSender,
      subject: 'Password changed for the ' + process.env.APP_TITLE,
      text: emailTextContent,
      html: emailHtmlContent,
    };

    try {
      await sgMail.send(msg);
    } catch (error) {
      if (error.response) {
        this.logger.error(error.response.body.errors);
      } else {
        this.logger.error(error);
      }
    }
  }

  /**
   * Send an email to the user.
   * @param toEmail
   * @param subject
   * @param textContent
   * @param htmlContent
   */
  async sendEmailToUser(
    toEmail: string,
    subject: string,
    textContent: string,
    htmlContent: string,
  ) {
    const msg = {
      to: toEmail,
      from: this.noReplyEmailFromSender,
      subject: subject,
      text: textContent,
      html: htmlContent,
    };

    try {
      await sgMail.send(msg);
    } catch (error) {
      if (error.response) {
        this.logger.error(error.response.body.errors);
      } else {
        this.logger.error(error);
      }
    }
  }
}
