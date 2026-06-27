import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a news post announcing the news and notifications update released in
 * Backend v1.0.187 and Frontend v1.0.214.
 */
export class SeedStoInfoNewsAndNotificationsUpdate1782518400000 implements MigrationInterface {
  name = 'SeedStoInfoNewsAndNotificationsUpdate1782518400000';

  /**
   * The STO Info post to seed. Body is authored as Markdown.
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
      slug: 'sto-info-news-and-notifications-update',
      title: 'News and Notifications Update',
      summary:
        'This update brings a new news page, better notifications, and a smoother overall experience for STO Info users.',
      category: 'RELEASE_NOTES',
      publishedAt: '2026-06-27T03:00:00.000Z',
      body: `This STO Info update brings a new way to keep up with what is happening in the app, along with several improvements that make the experience smoother and easier to use.

### What is new

#### News and updates

- A new news page has been added so important updates can be shared in one place.
- Older news items have also been added so you can catch up on past announcements.
- Notifications are now easier to follow, with unread items clearly marked and simple ways to clear them.

#### Easier management behind the scenes

- The tools used to manage news, banners, and notifications have been improved.
- These changes help keep future updates organised and easier to publish.

### A smoother experience

- Several pages now look cleaner and work better on screen.
- The menu, dashboard, and notification areas have been polished for a more consistent feel.
- Button styling has also been improved so common actions are easier to use.

### Behind-the-scenes improvements

- Extra checks have been added to help keep news and notification content reliable.
- Supporting updates were made to improve stability and reduce unnecessary background activity.
- Additional testing helps make sure the new features continue to work as expected.

### Fixes

- Fixed an issue that caused call-to-action buttons to be hidden, preventing users from viewing and interacting with them.

### Release information

This news post covers the following releases:

- [Backend v1.0.194](https://github.com/sto-info-app/sto-info-backend/releases/tag/v1.0.194)
- [Frontend v1.0.220](https://github.com/sto-info-app/sto-info-frontend/releases/tag/v1.0.220)`,
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
