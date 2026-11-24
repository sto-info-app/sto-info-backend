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
    expect(html).toContain('class="lcars-elbow"');
    expect(html).toContain('STO Info');
    expect(html).not.toMatch(/<img\b/i);
  });

  // Outlook draws no rounded corners, so it gets VML shapes (24 Nov redesign).
  it('draws the elbows and pills for Outlook too', async () => {
    const { html } = await notification('New comment on your work');

    // Two elbows and two bars.
    expect(html.match(/<v:shape /g)).toHaveLength(4);
    // The bars are flat but for their inside right corner (24 Nov).
    expect(html).toContain(
      'path="m 0,0 l 444,0 l 444,28 qy 416,56 l 0,56 x e"',
    );
    expect(html).toContain(
      'path="m 0,0 l 424,0 qx 444,20 l 444,40 l 0,40 x e"',
    );
    expect(html).toContain('border-radius: 0 0 28px 0');
    expect(html).toContain('border-radius: 0 20px 0 0');
    expect(html).not.toContain('border-radius: 28px');
    expect(html).toMatch(
      /<v:roundrect [^>]*href="https:\/\/sto\.test\/storytime\/stories\/the-long-watch"/,
    );
    expect(html).toContain('class="lcars-pill"');
    expect(html).toContain('Open in the STO Info</a>');
  });

  it('asks for Antonio only outside Outlook, and keeps black everywhere', async () => {
    const { html } = await notification('New comment on your work');

    expect(html).toMatch(
      /<!--\[if !mso\]><!-->\s*<link\s+href="https:\/\/fonts\.googleapis\.com\/css2\?family=Antonio/,
    );
    expect(html).toContain('<meta name="color-scheme" content="light dark" />');
    expect(html).not.toMatch(/bgcolor="#(?!0d0d0d|ffaa00|7788ff|cc88ff)/i);
  });

  // Outlook recolours backgrounds but not images, and marks what it changed.
  it('holds its colours when Outlook recolours a message', async () => {
    const { html } = await notification('New comment on your work');
    const backgrounds =
      html.match(/style="[^"]*?background-color: #[0-9a-f]{6};[^"]*/gi) ?? [];

    expect(backgrounds.length).toBeGreaterThan(10);
    for (const style of backgrounds) {
      expect(style).toMatch(/background-image: linear-gradient\(/);
    }
    // Every dark cell is coloured, with no image behind it: in classic
    // Outlook's light view a dark image left its darkened text unreadable.
    expect(html).not.toMatch(/url\(|<v:background|<v:fill/);
    expect(html.match(/<td [^>]*class="[^"]*lcars-cell/g)).toHaveLength(
      html.match(/<td [^>]*bgcolor="#0d0d0d"[^>]*class="[^"]*lcars-cell/g)
        ?.length ?? -1,
    );
    expect(html).toContain(
      '[data-ogsc] .lcars-text, .lcars-text[data-ogsc] { color: #ffffff !important; }',
    );
    expect(html).toContain(
      '.lcars-frame [data-ogsb] { background-color: transparent !important; }',
    );
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

    expect(html).toContain('class="lcars-elbow"');
    expect(text).toContain('STO Info');
    expect(text).not.toContain(NBSP);
  });

  it('brands content written elsewhere, such as the contact emails', async () => {
    const { html } = await service.brand('<p>Thanks</p>', 'We received it');

    expect(html).toContain('<p>Thanks</p>');
    expect(html).toContain('<title>We received it</title>');
  });
});
