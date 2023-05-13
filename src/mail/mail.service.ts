import { Injectable } from '@nestjs/common';
import * as sgMail from '@sendgrid/mail';

@Injectable()
export class MailService {
  noReplyEmailFromSender: string = `${process.env.APP_TITLE} <${process.env.SENDGRID_VERIFIED_SENDER}>`;

  constructor() {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  }

  async sendVerificationEmail(email: string, token: string) {
    const msg = {
      to: email,
      from: this.noReplyEmailFromSender,
      subject: 'Please verify your email',
      text: `Here is your email verification token: ${token}`,
      html: `<p>Thank you for registering with the ${process.env.APP_TITLE}, you are a click away from being able to use the facility.</p>
             <p>Please verify your email by clicking on the link below:</p>
             <a href="${process.env.APP_FRONTEND_URL}/verify-email?token=${token}">Verify Email</a>.</p>
             <p><em>This is an automated email, and replies will not get received.</em></p>`,
    };

    try {
      await sgMail.send(msg);
      // console.log('Email sent');
    } catch (error) {
      console.error(error);
    }
  }

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
      // console.log('Email sent');
    } catch (error) {
      console.error(error);
    }
  }
}
