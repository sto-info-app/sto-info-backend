import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the news feed with STO Info historical news posts adapted from the
 * original MidNiteShadow Online announcements so they read naturally inside
 * the STO Info App news page.
 */
export class SeedStoInfoNewsPosts1782000000000 implements MigrationInterface {
  name = 'SeedStoInfoNewsPosts1782000000000';

  /**
   * The STO Info posts to seed, oldest first. Bodies are authored as Markdown.
   */
  private readonly posts: {
    slug: string;
    title: string;
    summary: string;
    category: 'RELEASE_NOTES' | 'ANNOUNCEMENT' | 'GENERAL';
    publishedAt: string;
    body: string;
  }[] = [
    {
      slug: 'version-1-of-sto-info-is-now-live',
      title: 'STO Info 1.0 Launch',
      summary:
        'The first public version of STO Info introduced account and character tracking for Star Trek Online players.',
      category: 'ANNOUNCEMENT',
      publishedAt: '2026-02-05T00:00:00.000Z',
      body: `STO Info 1.0 marked the first public release of the app.

This initial version introduced the foundations of the service, focused on helping Star Trek Online players keep track of their STO accounts and characters in one place.

### Included in this release

- STO account tracking
- Character tracking
- The first version of the STO Info user interface
- Core account registration and sign-in functionality

This release established the base that future updates would build on, including character statistics, account statistics, fleet roster tracking, and wider dashboard improvements.

Live long and prosper 🖖`,
    },
    {
      slug: 'sto-info-update-character-count-fix-stability-improvements',
      title: 'Character Count Fix and Stability Improvements',
      summary:
        'This update corrected STO account character counts and added improved error monitoring for greater reliability.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-02-08T00:00:00.000Z',
      body: `This release focused on improving reliability and correcting an issue with STO account character totals.

### User-facing fix

- Fixed STO account character counts so totals display correctly.

### Reliability improvements

- Added Sentry-backed error monitoring to help identify application issues more quickly.
- Improved internal logging and request tracking.
- Added general maintenance updates across dependencies, security checks, and workflows.

Sentry is used only to help diagnose errors and improve stability. It is not used for advertising, behavioural tracking, or monitoring how individual users browse the site.

Personal data collection for error monitoring is disabled, and retained diagnostic data is limited in line with the privacy policy.`,
    },
    {
      slug: 'sto-info-frontend-backend-update-deployed',
      title: 'Privacy, Security and Contact Improvements',
      summary:
        'This frontend and backend update added contact handling, privacy cleanup jobs, accessibility improvements, and stronger authentication support.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-02-10T00:00:00.000Z',
      body: `This release updated both the STO Info frontend and backend, with a focus on privacy, security, accessibility, and user support.

### Backend changes

- Added contact form handling.
- Added an automated cleanup job for contact requests.
- Added configurable retention periods for email masking and record deletion.
- Improved refresh token verification.

### Frontend changes

- Added About the Team pages for developers, volunteers, and supporters.
- Added the contact form for feedback and enquiries.
- Improved accessibility with ARIA labels, image titles, and interface polish.
- Improved cookie security settings.
- Updated dependencies and refactored areas of the application for maintainability.

This update strengthened the app's support and privacy foundations while improving the experience for users who want to report issues or provide feedback.`,
    },
    {
      slug: 'sto-info-app-production-update-email-fix-major-backend-frontend-improvements',
      title: 'Microsoft Email Delivery Fix and Platform Improvements',
      summary:
        'This production release fixed Microsoft email delivery issues and included a broad set of backend, frontend, security, and infrastructure updates.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-02-25T00:00:00.000Z',
      body: `This production release included significant backend and frontend updates, with a major fix for email delivery to Microsoft-hosted accounts.

### Microsoft email delivery fix

The email sending provider was changed to resolve delivery issues affecting Microsoft accounts, including Outlook, Hotmail, and Live addresses.

Users registering with Microsoft email addresses should now receive confirmation and notification emails more reliably.

### Backend improvements

- Added security workflow improvements, including CodeQL, ZAP DAST, and fuzz testing.
- Strengthened CI enforcement with DCO and audit jobs.
- Improved explicit entity typing for database consistency.
- Updated runtime and tooling dependencies.
- Updated AWS SDK, Redis, ESLint, and CI actions.
- Refined project documentation.

### Frontend improvements

- Improved team pages and contact form handling.
- Added CI security checks, including fuzzing and ZAP coverage.
- Improved automated release workflows.
- Moved Font Awesome to CDN delivery to reduce build weight.
- Updated Angular and supporting tooling.
- Adjusted ESLint configuration for compatibility.
- Updated frontend documentation.

This release cycle focused on reliability, maintainability, security hardening, and the infrastructure needed to support future STO Info features.`,
    },
    {
      slug: 'sto-info-update-character-add-fix-stability-improvements',
      title: 'Character Creation Fix and Authentication Improvements',
      summary:
        'This production update fixed an issue that could prevent characters from being added and improved authentication stability.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-03-01T00:00:00.000Z',
      body: `This production update resolved a character creation issue and improved the stability of authentication between the frontend and backend.

### Included in this release

- Fixed an issue that could prevent characters from being added.
- Improved authentication handling between the frontend and backend.
- Refined CI workflows.
- Updated dependencies.
- Added general stability improvements.

This update was primarily focused on making character management more reliable for users.`,
    },
    {
      slug: 'sto-info-update-character-statistics-filtering-dashboard-improvements-automation-updates',
      title: 'Character Statistics Filtering and Dashboard Improvements',
      summary:
        'This release added character statistics filtering, improved the dashboard, and introduced additional release and contributor automation.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-03-09T00:00:00.000Z',
      body: `This release improved the STO Info dashboard and added new automation to support ongoing development.

### New features

- Added character statistics to the dashboard.
- Added filtering support for character statistics.
- Added automated release note generation as part of the CI pipeline.
- Improved contributor recognition automation.

### Fixes and improvements

- Improved home page alignment.
- Fixed CI workflow issues.
- Improved CI reliability.
- Updated contributor badge links.

### Maintenance

- Updated Angular and tooling dependencies.
- Added security dependency overrides.
- Improved CodeQL and CI workflows.

This release continued the move towards a more useful dashboard while strengthening the release process behind the app.

### Related release tags

- Frontend v1.0.154
- Backend v1.0.131`,
    },
    {
      slug: 'sto-info-update-lcars-ui-refresh',
      title: 'LCARS-Inspired UI Refresh',
      summary:
        'This visual update moved the STO Info interface further towards a LCARS-inspired Star Trek look and feel.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-03-16T00:00:00.000Z',
      body: `This release introduced a significant user interface refresh, moving STO Info further towards a LCARS-inspired visual style.

### Included in this release

- Refactored areas of the user interface.
- Updated the app's visual direction to better match the Star Trek-inspired design goal.
- Continued usability improvements across the frontend.
- Continued backend maintenance and fixes.

The purpose of this update was to make the app feel more distinctive while preserving a fast, practical, and easy-to-use interface for tracking STO information.

### Related release tags

- Frontend v1.0.162
- Backend v1.0.141`,
    },
    {
      slug: 'sto-info-app-update-continued-lcars-ui-improvements',
      title: 'Continued LCARS UI and Stability Improvements',
      summary:
        'This follow-up release continued LCARS-style interface refinements, usability improvements, and backend stability work.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-03-30T00:00:00.000Z',
      body: `This update continued the LCARS-inspired interface work introduced in earlier releases.

### Included in this release

- Further LCARS-style UI refinements.
- Improved layout consistency.
- Improved usability across the app.
- Continued backend enhancements and fixes.
- General stability improvements.

This release formed part of the ongoing effort to evolve STO Info's visual identity while keeping the application clear, responsive, and practical for regular use.`,
    },
    {
      slug: 'star-trek-online-info-from-spreadsheet-to-web-app',
      title: 'From Spreadsheet to STO Info App',
      summary:
        'This background article explains how STO Info grew from a personal Star Trek Online spreadsheet into a free community web app.',
      category: 'GENERAL',
      publishedAt: '2026-04-05T00:00:00.000Z',
      body: `STO Info began as a personal spreadsheet for tracking Star Trek Online information.

Over time, that spreadsheet grew into a much larger project and eventually became a dedicated web app for the STO community.

This video shows where it began, and what it has become: https://youtu.be/pXSzMqregd8

### Project goal

STO Info is intended to provide a free, community-run place for players to track and manage Star Trek Online information, including accounts, characters, progress, statistics, and future planned features.

### Early focus

The first public versions focused on:

- Account tracking
- Character tracking
- Dashboard improvements
- Character statistics
- A LCARS-inspired interface
- Privacy-conscious account and contact handling

The app remains an ongoing community project, with future work planned around broader tracking, statistics, and roster management features.`,
    },
  ];

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const post of this.posts) {
      await queryRunner.query(
        `
          INSERT INTO "sto_info_app"."news_post"
            ("slug", "title", "summary", "body", "category", "status", "publishedAt")
          VALUES ($1, $2, $3, $4, $5, 'PUBLISHED', $6)
          ON CONFLICT ("slug") DO UPDATE SET
            "title" = EXCLUDED."title",
            "summary" = EXCLUDED."summary",
            "body" = EXCLUDED."body",
            "category" = EXCLUDED."category",
            "status" = EXCLUDED."status",
            "publishedAt" = EXCLUDED."publishedAt"
        `,
        [
          post.slug,
          post.title,
          post.summary,
          post.body,
          post.category,
          post.publishedAt,
        ],
      );
    }
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."news_post" WHERE "slug" = ANY($1)`,
      [this.posts.map(post => post.slug)],
    );
  }
}
