import { MailerService } from '@nestjs-modules/mailer';

import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { SesWebhookService } from 'src/webhooks/ses/ses-webhook.service';

import { MailService } from './mail.service';

/**
 * The branded layout every email shares, rendered for real (sc-1067).
 *
 * The mail service's own spec mocks EJS; this one renders the templates so a
 * broken tag, an unescaped value or a plain-text part full of layout shows up.
 */
/** What the empty LCARS bars hold. */
const NBSP = String.fromCharCode(0xa0);

describe('branded email templates (sc-1067)', () => {
  const env = { ...process.env };
  let service: MailService;

  beforeEach(() => {
    process.env.APP_TITLE = 'STO Info';
    process.env.EMAIL_NOREPLY_SENDER = 'no-reply@sto.test';
    process.env.APP_FRONTEND_URL = 'https://sto.test';
    process.env.AWS_SES_CONFIGURATION_SET = 'set';
    service = new MailService(
      {} as ValidatorsService,
      {} as MailerService,
      {} as SesWebhookService,
    );
  });

  afterEach(() => {
    process.env = { ...env };
  });

  const notification = (title: string) =>
    service.renderEmail(
      'notification-email.ejs',
      {
        firstName: 'James',
        digest: null,
        items: [
          {
            title,
            body: 'Someone commented on your Story "The Long Watch".',
            linkUrl: 'https://sto.test/storytime/stories/the-long-watch',
          },
        ],
      },
      title,
      {
        template: 'notification-email-footer.ejs',
        data: {
          labels: ['Comments on my work'],
          unsubscribeLinks: [
            {
              label: 'comments on my work',
              url: 'https://sto.test/email/unsubscribe?token=abc',
            },
          ],
          settingsUrl: 'https://sto.test/dashboard/settings?tab=notifications',
        },
      },
    );

  it('puts the content inside the LCARS layout, with no images', async () => {
    const { html } = await notification('New comment on your work');

    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>New comment on your work</title>');
    expect(html).toContain('class="lcars-bar"');
    expect(html).toContain('STO Info');
    expect(html).not.toMatch(/<img\b/i);
  });

  it('writes a plain-text part without the layout', async () => {
    const { text } = await notification('New comment on your work');

    expect(text).toContain('Hi James,');
    expect(text).toContain('New comment on your work');
    expect(text).toContain(
      'Open in the STO Info [https://sto.test/storytime/stories/the-long-watch]',
    );
    expect(text).toContain(
      'Stop emails about comments on my work [https://sto.test/email/unsubscribe?token=abc]',
    );
    expect(text).toContain('Manage email notifications');
    // The bars hold nothing but non-breaking spaces.
    expect(text).not.toContain(NBSP);
    expect(text).not.toMatch(/<[a-z]/i);
  });

  // A title is written by whoever acted, such as a Story's name.
  it('escapes what the notice says', async () => {
    const { html } = await notification('<script>alert(1)</script>');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('introduces a digest by its name', async () => {
    const { text } = await service.renderEmail(
      'notification-email.ejs',
      { firstName: 'James', digest: 'weekly', items: [] },
      'Your weekly digest',
    );

    expect(text).toContain(
      'Here is what happened on the STO Info since your last weekly email.',
    );
  });

  it.each([
    [
      'registration-verify-email.ejs',
      { verifyUrl: 'https://sto.test/verify-email?token=t' },
    ],
    [
      'registration-welcome-email.ejs',
      {
        user: { firstName: 'James' },
        loginUrl: 'https://sto.test/login',
        termsOfUseUrl: 'https://sto.test/terms-of-use',
      },
    ],
    [
      'password-reset-email.ejs',
      {
        firstName: 'James',
        passwordResetUrl: 'https://sto.test/change-password?token=t',
      },
    ],
    [
      'password-changed-email.ejs',
      {
        firstName: 'James',
        passwordResetUrl: 'https://sto.test/reset-password',
        contactUsUrl: 'https://sto.test/contact',
      },
    ],
    [
      'account-closure-email.ejs',
      { firstName: 'James', contactUsUrl: 'https://sto.test/contact' },
    ],
    [
      'user-logged-in.ejs',
      {
        firstName: 'James',
        passwordResetUrl: 'https://sto.test/reset-password',
        contactUsUrl: 'https://sto.test/contact',
      },
    ],
  ])('brands %s', async (template, data) => {
    const { html, text } = await service.renderEmail(template, data, 'Subject');

    expect(html).toContain('class="lcars-bar"');
    expect(text).toContain('STO Info');
    expect(text).not.toContain(NBSP);
  });

  it('brands content written elsewhere, such as the contact emails', async () => {
    const { html } = await service.brand('<p>Thanks</p>', 'We received it');

    expect(html).toContain('<p>Thanks</p>');
    expect(html).toContain('<title>We received it</title>');
  });
});
